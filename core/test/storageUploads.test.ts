import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	ListPartsCommand,
	S3Client
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { S3ObjectStore } from "../src/storage";

const s3Mock = mockClient(S3Client);
const REGION = "us-east-2";
const KEY = "acme/uploads/0b1c2d3e-0000-4000-8000-000000000001/clip.mp4";

function store(): S3ObjectStore {
	const client = new S3Client({
		region: REGION,
		credentials: { accessKeyId: "test", secretAccessKey: "test" }
	});
	return new S3ObjectStore(client, "media-bucket");
}

describe("S3ObjectStore uploads", () => {
	beforeEach(() => {
		s3Mock.reset();
	});

	it("presigns a PUT for the media bucket with the requested expiry", async () => {
		const url = await store().presignPut(KEY, 900, "video/mp4");

		expect(url).toMatch(new RegExp(`^https://media-bucket\\.s3\\.${REGION}\\.amazonaws\\.com/${KEY}\\?`));
		expect(url).toContain("X-Amz-Expires=900");
	});

	it("creates a multipart upload in the media bucket and returns its UploadId", async () => {
		s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "up-1" });

		expect(await store().createMultipartUpload(KEY, "video/mp4")).toBe("up-1");
		expect(s3Mock.commandCall(0, CreateMultipartUploadCommand).args[0].input).toMatchObject({
			Bucket: "media-bucket",
			Key: KEY,
			ContentType: "video/mp4"
		});
	});

	it("fails when S3 returns no UploadId", async () => {
		s3Mock.on(CreateMultipartUploadCommand).resolves({});

		await expect(store().createMultipartUpload(KEY)).rejects.toThrow(/UploadId/);
	});

	it("presigns a part URL carrying the part number and upload id", async () => {
		const url = await store().presignPart(KEY, "up-1", 3, 600);

		expect(url).toContain(KEY);
		expect(url).toContain("X-Amz-Expires=600");
		expect(url).toContain("partNumber=3");
		expect(url).toContain("uploadId=up-1");
	});

	it("lists every uploaded part across pages", async () => {
		s3Mock
			.on(ListPartsCommand)
			.resolvesOnce({
				Parts: [{ PartNumber: 1, ETag: '"etag-1"', Size: 5 }],
				IsTruncated: true,
				NextPartNumberMarker: "1"
			})
			.resolvesOnce({ Parts: [{ PartNumber: 2, ETag: '"etag-2"', Size: 3 }], IsTruncated: false });

		expect(await store().listParts(KEY, "up-1")).toEqual([
			{ partNumber: 1, etag: '"etag-1"', sizeBytes: 5 },
			{ partNumber: 2, etag: '"etag-2"', sizeBytes: 3 }
		]);
		expect(s3Mock.commandCalls(ListPartsCommand)).toHaveLength(2);
		expect(s3Mock.commandCall(0, ListPartsCommand).args[0].input).toMatchObject({
			Bucket: "media-bucket",
			Key: KEY,
			UploadId: "up-1"
		});
	});

	it("completes a multipart upload with the given parts", async () => {
		s3Mock.on(CompleteMultipartUploadCommand).resolves({});

		await store().completeMultipartUpload(KEY, "up-1", [{ partNumber: 1, etag: "etag-1" }]);

		expect(s3Mock.commandCall(0, CompleteMultipartUploadCommand).args[0].input).toMatchObject({
			Bucket: "media-bucket",
			Key: KEY,
			UploadId: "up-1",
			MultipartUpload: { Parts: [{ PartNumber: 1, ETag: "etag-1" }] }
		});
	});

	it("aborts a multipart upload in the media bucket", async () => {
		s3Mock.on(AbortMultipartUploadCommand).resolves({});

		await store().abortMultipartUpload(KEY, "up-1");

		expect(s3Mock.commandCall(0, AbortMultipartUploadCommand).args[0].input).toMatchObject({
			Bucket: "media-bucket",
			Key: KEY,
			UploadId: "up-1"
		});
	});
});
