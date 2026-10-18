import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	S3Client
} from "@aws-sdk/client-s3";
import { ForbiddenError, ValidationError } from "@helios/contracts";
import { mockClient } from "aws-sdk-client-mock";
import { config, resetConfigForTests } from "../src/config";
import { resetObjectStoreForTests } from "../src/storage";
import {
	abortMultipartUpload,
	assertOwnedUploadKey,
	completeMultipartUpload,
	createMultipartUpload,
	createPresignedUpload,
	createRawFileUpload,
	partSizeFor,
	sanitizeFilename
} from "../src/uploads";

const s3Mock = mockClient(S3Client);
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const TiB = 1024 * GiB;
const OWN_KEY = "acme/uploads/0b1c2d3e-0000-4000-8000-000000000001/clip.mp4";
const FOREIGN_KEY = "globex/uploads/0b1c2d3e-0000-4000-8000-000000000001/clip.mp4";

describe("uploads", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" };
		resetConfigForTests();
		resetObjectStoreForTests();
		s3Mock.reset();
	});

	afterEach(() => {
		process.env = originalEnv;
		resetConfigForTests();
		resetObjectStoreForTests();
	});

	describe("sanitizeFilename", () => {
		it("replaces unsafe characters with underscores", () => {
			expect(sanitizeFilename("my file (1)é.mp4")).toBe("my_file__1__.mp4");
		});

		it("never leaves a dot sequence that could traverse directories", () => {
			expect(sanitizeFilename("../../etc/passwd")).not.toContain("..");
			expect(sanitizeFilename("a..b.mp4")).toBe("a_b.mp4");
		});

		it("truncates to 200 characters", () => {
			expect(sanitizeFilename("a".repeat(300))).toHaveLength(200);
		});
	});

	describe("createPresignedUpload", () => {
		it("presigns a single PUT under the account's uploads prefix", async () => {
			const response = await createPresignedUpload("acme", {
				filename: "clip.mp4",
				sizeBytes: MiB,
				contentType: "video/mp4"
			});

			expect(response.uploadKey).toMatch(/^acme\/uploads\/[0-9a-f-]{36}\/clip\.mp4$/);
			expect(response.url).toContain("/acme/uploads/");
			expect(response.url).toContain("/clip.mp4?");
			expect(response.url).toContain("X-Amz-Expires=900");
		});

		it("builds the upload key from the sanitized filename", async () => {
			const response = await createPresignedUpload("acme", {
				filename: "my file.mp4",
				sizeBytes: MiB,
				contentType: "video/mp4"
			});

			expect(response.uploadKey).toMatch(/^acme\/uploads\/[0-9a-f-]{36}\/my_file\.mp4$/);
		});

		it("accepts a file exactly at MAX_UPLOAD_BYTES", async () => {
			const sizeBytes = config().MAX_UPLOAD_BYTES;

			await expect(createPresignedUpload("acme", { filename: "clip.mp4", sizeBytes })).resolves.toBeDefined();
		});

		it("rejects a file over MAX_UPLOAD_BYTES", async () => {
			const sizeBytes = config().MAX_UPLOAD_BYTES + 1;

			await expect(createPresignedUpload("acme", { filename: "clip.mp4", sizeBytes })).rejects.toThrow(ValidationError);
		});
	});

	describe("multipart", () => {
		it("uses 5 MiB parts and presigns one URL per part for a 12 MiB file", async () => {
			s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "up-1" });

			const response = await createMultipartUpload("acme", {
				filename: "clip.mp4",
				contentType: "video/mp4",
				sizeBytes: 12 * MiB
			});

			expect(response.uploadId).toBe("up-1");
			expect(response.partSizeBytes).toBe(5 * MiB);
			expect(response.parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);
			expect(response.parts[0]?.url).toContain("partNumber=1");
			expect(response.parts[2]?.url).toContain("partNumber=3");
			expect(response.parts[2]?.url).toContain("uploadId=up-1");
			expect(response.uploadKey).toMatch(/^acme\/uploads\//);
		});

		it("sizes parts so the part count stays within 10000 and each part within 5 GiB", () => {
			for (const size of [5 * GiB, 5e12, 40 * TiB]) {
				const partSize = partSizeFor(size);
				expect(Math.ceil(size / partSize)).toBeLessThanOrEqual(10000);
				expect(partSize).toBeLessThanOrEqual(5 * GiB);
				expect(partSize).toBeGreaterThanOrEqual(5 * MiB);
			}
		});

		it("rejects a size whose parts would exceed 5 GiB", () => {
			expect(() => partSizeFor(60 * TiB)).toThrow(ValidationError);
		});

		it("rejects a multipart upload over MAX_UPLOAD_BYTES without calling S3", async () => {
			await expect(
				createMultipartUpload("acme", { filename: "clip.mp4", sizeBytes: config().MAX_UPLOAD_BYTES + 1 })
			).rejects.toThrow(ValidationError);
			expect(s3Mock.commandCalls(CreateMultipartUploadCommand)).toHaveLength(0);
		});

		it("completes the upload with parts sorted by part number", async () => {
			s3Mock.on(CompleteMultipartUploadCommand).resolves({});

			const uploadKey = await completeMultipartUpload("acme", {
				uploadId: "up-1",
				uploadKey: OWN_KEY,
				parts: [
					{ partNumber: 2, etag: "etag-2" },
					{ partNumber: 1, etag: "etag-1" }
				]
			});

			expect(uploadKey).toBe(OWN_KEY);
			expect(s3Mock.commandCall(0, CompleteMultipartUploadCommand).args[0].input).toMatchObject({
				UploadId: "up-1",
				MultipartUpload: {
					Parts: [
						{ PartNumber: 1, ETag: "etag-1" },
						{ PartNumber: 2, ETag: "etag-2" }
					]
				}
			});
		});

		it("aborts the upload", async () => {
			s3Mock.on(AbortMultipartUploadCommand).resolves({});

			await abortMultipartUpload("acme", { uploadId: "up-1", uploadKey: OWN_KEY });

			expect(s3Mock.commandCall(0, AbortMultipartUploadCommand).args[0].input).toMatchObject({
				UploadId: "up-1",
				Key: OWN_KEY
			});
		});

		it("rejects completing an upload key owned by another account", async () => {
			await expect(
				completeMultipartUpload("acme", {
					uploadId: "up-1",
					uploadKey: FOREIGN_KEY,
					parts: [{ partNumber: 1, etag: "etag-1" }]
				})
			).rejects.toThrow(ForbiddenError);
			expect(s3Mock.commandCalls(CompleteMultipartUploadCommand)).toHaveLength(0);
		});

		it("rejects aborting an upload key owned by another account", async () => {
			await expect(abortMultipartUpload("acme", { uploadId: "up-1", uploadKey: FOREIGN_KEY })).rejects.toThrow(
				ForbiddenError
			);
			expect(s3Mock.commandCalls(AbortMultipartUploadCommand)).toHaveLength(0);
		});
	});

	describe("assertOwnedUploadKey", () => {
		const UUID = "0b1c2d3e-0000-4000-8000-000000000001";

		it.each([`acme/uploads/${UUID}/clip.mp4`, `acme/uploads/${UUID}/my-file_1.v2.mp4`])("accepts %s", (key) => {
			expect(() => assertOwnedUploadKey("acme", key)).not.toThrow();
		});

		it.each([
			FOREIGN_KEY,
			`acme/files/${UUID}/clip.mp4`,
			`acme/uploads/not-a-uuid/clip.mp4`,
			`acme/uploads/0b1c2d3e-0000-1000-8000-000000000001/clip.mp4`,
			`acme/uploads/${UUID}/sub/clip.mp4`,
			`acme/uploads/${UUID}/../clip.mp4`,
			`acme/uploads/${UUID}/clip..mp4`,
			`acme/uploads/${UUID}/`,
			`acme/uploads/${UUID}/clip mp4`
		])("rejects %s", (key) => {
			expect(() => assertOwnedUploadKey("acme", key)).toThrow(ForbiddenError);
		});
	});

	describe("createRawFileUpload", () => {
		it("returns a raw file key under the account's files prefix with a CDN url", async () => {
			const response = await createRawFileUpload("acme", {
				filename: "clip.mp4",
				contentType: "video/mp4"
			});

			expect(response.fileKey).toMatch(/^acme\/files\//);
			expect(response.url).toBe(`${config().CDN_BASE_URL}/${response.fileKey}`);
			expect(response.uploadUrl).toContain(response.fileKey);
		});
	});
});
