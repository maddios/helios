import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	ListPartsCommand,
	S3Client,
	S3ServiceException
} from "@aws-sdk/client-s3";
import { ConflictError, ValidationError, type CreateUploadRequest } from "@helios/contracts";
import { mockClient } from "aws-sdk-client-mock";
import { createAccount } from "../../src/accounts";
import type { Account } from "../../src/models";
import { files, type FileRecord } from "../../src/models";
import { expirePendingFiles, loadFile } from "../../src/files";
import { resetObjectStoreForTests } from "../../src/storage";
import { abortUpload, completeUpload, createUpload, listUploadParts, signUploadParts } from "../../src/uploads";
import { resetDb, startMongo, stopMongo } from "../helpers/mongo";

const s3Mock = mockClient(S3Client);
const MiB = 1024 * 1024;
const PNG_BYTES = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
	Buffer.from("IHDR"),
	Buffer.from([0, 0, 0x01, 0x40, 0, 0, 0, 0x90, 8, 6, 0, 0, 0])
]);
const TEXT_BYTES = Buffer.from("definitely not a png\n");

let account: Account;

function notFound(): S3ServiceException {
	return new S3ServiceException({
		name: "NotFound",
		$fault: "client",
		$metadata: { httpStatusCode: 404 },
		message: "nf"
	});
}

function body(bytes: Buffer) {
	return { transformToByteArray: async () => new Uint8Array(bytes) } as never;
}

function imageRequest(overrides: Partial<CreateUploadRequest> = {}): CreateUploadRequest {
	return { filename: "logo.png", sizeBytes: PNG_BYTES.length, contentType: "image/png", ...overrides };
}

async function storedRecord(fileId: string): Promise<FileRecord> {
	return loadFile(account._id, fileId);
}

beforeAll(() => startMongo());
afterAll(() => stopMongo());
beforeEach(async () => {
	process.env.AWS_ACCESS_KEY_ID = "test";
	process.env.AWS_SECRET_ACCESS_KEY = "test";
	await resetDb();
	resetObjectStoreForTests();
	s3Mock.reset();
	account = await createAccount({
		slug: "acme",
		name: "Acme",
		sourceBuckets: [],
		features: { peopleAttributes: false }
	});
	s3Mock.on(DeleteObjectsCommand).resolves({ Errors: [] });
	s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
	s3Mock.on(AbortMultipartUploadCommand).resolves({});
});

describe("createUpload", () => {
	it("returns a single presigned PUT that signs the content type, for a file at or under the threshold", async () => {
		const created = await createUpload(account, imageRequest({ sizeBytes: 8 * MiB }));

		expect(created).toMatchObject({
			mode: "single",
			key: `acme/files/${created.fileId}/logo.png`,
			headers: { "Content-Type": "image/png" }
		});
		expect(created.mode === "single" && created.url).toMatch(/X-Amz-SignedHeaders=[^&]*content-type/);
		expect(await files().findOne({ _id: created.fileId })).toMatchObject({ status: "PENDING", source: "upload" });
	});

	it("starts a multipart upload above the threshold and presigns one URL per part", async () => {
		s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "up-1" });

		const created = await createUpload(
			account,
			imageRequest({ filename: "clip.mp4", sizeBytes: 12 * MiB, contentType: "video/mp4" })
		);

		expect(created).toMatchObject({ mode: "multipart", uploadId: "up-1", partSizeBytes: 5 * MiB });
		expect(created.mode === "multipart" && created.parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);
		expect(await files().findOne({ _id: created.fileId })).toMatchObject({ uploadId: "up-1", partCount: 3 });
	});

	it("rejects a declared type the account policy does not allow with 422 policy_violation", async () => {
		await expect(
			createUpload(account, imageRequest({ contentType: "video/mp4", filename: "a.mp4" }))
		).resolves.toBeDefined();
		const narrow = await createAccount({
			slug: "narrow",
			name: "Narrow",
			sourceBuckets: [],
			features: { peopleAttributes: false },
			uploadPolicy: { allowedContentTypes: ["image/*"], maxBytes: 10 * MiB }
		});

		await expect(
			createUpload(narrow, imageRequest({ contentType: "video/mp4", filename: "a.mp4" }))
		).rejects.toMatchObject({
			httpStatus: 422,
			code: "policy_violation"
		});
	});

	it("rejects a request policy that widens the account policy", async () => {
		const narrow = await createAccount({
			slug: "narrow",
			name: "Narrow",
			sourceBuckets: [],
			features: { peopleAttributes: false },
			uploadPolicy: { allowedContentTypes: ["image/*"], maxBytes: 10 * MiB }
		});

		await expect(
			createUpload(narrow, imageRequest({ policy: { allowedContentTypes: ["video/*"], maxBytes: MiB } }))
		).rejects.toThrow(ValidationError);
	});

	it("rejects a file over the upload limit", async () => {
		await expect(
			createUpload(account, imageRequest({ sizeBytes: Number(process.env.MAX_UPLOAD_BYTES) + 1 }))
		).rejects.toThrow(ValidationError);
	});
});

describe("completeUpload", () => {
	it("stores a single PUT, sniffing the type and the image dimensions", async () => {
		const created = await createUpload(account, imageRequest());
		s3Mock.on(HeadObjectCommand).resolves({ ContentLength: PNG_BYTES.length, ETag: '"e"' });
		s3Mock.on(GetObjectCommand).resolves({ Body: body(PNG_BYTES) });

		const file = await completeUpload(account, created.fileId, undefined);

		expect(file).toMatchObject({
			status: "STORED",
			contentType: "image/png",
			sizeBytes: PNG_BYTES.length,
			image: { width: 320, height: 144, format: "png" }
		});
		expect(file.storedAt).toBeInstanceOf(Date);
	});

	it("deletes the object and marks the file FAILED when the bytes do not match the declared image type", async () => {
		const created = await createUpload(account, imageRequest({ sizeBytes: TEXT_BYTES.length }));
		s3Mock.on(HeadObjectCommand).resolves({ ContentLength: TEXT_BYTES.length, ETag: '"e"' });
		s3Mock.on(GetObjectCommand).resolves({ Body: body(TEXT_BYTES) });

		await expect(completeUpload(account, created.fileId, undefined)).rejects.toMatchObject({
			httpStatus: 422,
			code: "policy_violation"
		});

		expect(s3Mock.commandCalls(DeleteObjectsCommand)[0].args[0].input.Delete?.Objects).toEqual([{ Key: created.key }]);
		expect(await storedRecord(created.fileId)).toMatchObject({ status: "FAILED" });
	});

	it("is idempotent: completing a stored file returns it without touching storage", async () => {
		const created = await createUpload(account, imageRequest());
		s3Mock.on(HeadObjectCommand).resolves({ ContentLength: PNG_BYTES.length, ETag: '"e"' });
		s3Mock.on(GetObjectCommand).resolves({ Body: body(PNG_BYTES) });
		await completeUpload(account, created.fileId, undefined);
		s3Mock.resetHistory();

		const again = await completeUpload(account, created.fileId, undefined);

		expect(again.status).toBe("STORED");
		expect(s3Mock.calls()).toHaveLength(0);
	});

	it("reports a missing object with 422 source_not_found", async () => {
		const created = await createUpload(account, imageRequest());
		s3Mock.on(HeadObjectCommand).rejects(notFound());

		await expect(completeUpload(account, created.fileId, undefined)).rejects.toMatchObject({
			httpStatus: 422,
			code: "source_not_found"
		});
	});

	it("completes a multipart upload from its parts, and requires them", async () => {
		s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "up-1" });
		const created = await createUpload(account, imageRequest({ filename: "clip.png", sizeBytes: 12 * MiB }));
		s3Mock
			.on(HeadObjectCommand)
			.rejectsOnce(notFound())
			.rejectsOnce(notFound())
			.resolves({ ContentLength: 12 * MiB, ETag: '"e"' });
		s3Mock.on(CompleteMultipartUploadCommand).resolves({});
		s3Mock.on(GetObjectCommand).resolves({ Body: body(PNG_BYTES) });

		await expect(completeUpload(account, created.fileId, undefined)).rejects.toThrow(ValidationError);
		const file = await completeUpload(account, created.fileId, [
			{ partNumber: 2, etag: '"b"' },
			{ partNumber: 1, etag: '"a"' }
		]);

		expect(file.status).toBe("STORED");
		expect(s3Mock.commandCalls(CompleteMultipartUploadCommand)[0].args[0].input.MultipartUpload?.Parts).toEqual([
			{ PartNumber: 1, ETag: '"a"' },
			{ PartNumber: 2, ETag: '"b"' }
		]);
	});

	it("rejects parts sent for a single PUT", async () => {
		const created = await createUpload(account, imageRequest());

		await expect(completeUpload(account, created.fileId, [{ partNumber: 1, etag: '"a"' }])).rejects.toThrow(
			ValidationError
		);
	});
});

describe("parts and abort", () => {
	beforeEach(() => {
		s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "up-1" });
	});

	it("signs only parts inside the planned count", async () => {
		const created = await createUpload(account, imageRequest({ filename: "clip.png", sizeBytes: 12 * MiB }));

		await expect(signUploadParts(account, created.fileId, [3])).resolves.toMatchObject({
			parts: [{ partNumber: 3 }]
		});
		await expect(signUploadParts(account, created.fileId, [4])).rejects.toThrow(/beyond the 3 parts/);
	});

	it("lists the parts storage holds for a pending multipart upload", async () => {
		const created = await createUpload(account, imageRequest({ filename: "clip.png", sizeBytes: 12 * MiB }));
		s3Mock
			.on(ListPartsCommand)
			.resolves({ Parts: [{ PartNumber: 1, ETag: '"a"', Size: 5 * MiB }], IsTruncated: false });

		await expect(listUploadParts(account._id, created.fileId)).resolves.toEqual({
			parts: [{ partNumber: 1, etag: '"a"', sizeBytes: 5 * MiB }]
		});
	});

	it("aborts a pending multipart upload and marks the file FAILED", async () => {
		const created = await createUpload(account, imageRequest({ filename: "clip.png", sizeBytes: 12 * MiB }));
		s3Mock.on(HeadObjectCommand).rejects(notFound());

		await abortUpload(account._id, created.fileId);

		expect(s3Mock.commandCalls(AbortMultipartUploadCommand)[0].args[0].input).toMatchObject({ UploadId: "up-1" });
		expect(await storedRecord(created.fileId)).toMatchObject({ status: "FAILED", error: "Upload was aborted" });
	});

	it("refuses to abort a file that is no longer pending", async () => {
		const created = await createUpload(account, imageRequest());
		s3Mock.on(HeadObjectCommand).resolves({ ContentLength: PNG_BYTES.length, ETag: '"e"' });
		s3Mock.on(GetObjectCommand).resolves({ Body: body(PNG_BYTES) });
		await completeUpload(account, created.fileId, undefined);

		await expect(abortUpload(account._id, created.fileId)).rejects.toThrow(ConflictError);
	});
});

describe("expirePendingFiles", () => {
	it("fails pending files past their expiry and deletes what they stored, leaving other files alone", async () => {
		const created = await createUpload(account, imageRequest());
		const fresh = await createUpload(account, imageRequest({ filename: "fresh.png" }));
		await files().updateOne({ _id: created.fileId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

		await expirePendingFiles(new Date());

		expect(await storedRecord(created.fileId)).toMatchObject({
			status: "FAILED",
			error: expect.stringMatching(/expired/)
		});
		expect(await storedRecord(fresh.fileId)).toMatchObject({ status: "PENDING" });
		expect(s3Mock.commandCalls(DeleteObjectsCommand)[0].args[0].input.Delete?.Objects).toEqual([{ Key: created.key }]);
	});
});
