import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import path from "node:path";
import { stat } from "node:fs/promises";
import { resetConfigForTests } from "../src/config";
import { objectStore, resetObjectStoreForTests, S3ObjectStore } from "../src/storage";

const s3Mock = mockClient(S3Client);
const REGION = "us-east-2";
const PACKAGE_JSON = path.resolve(__dirname, "../package.json");

function store(): S3ObjectStore {
	const client = new S3Client({
		region: REGION,
		credentials: { accessKeyId: "test", secretAccessKey: "test" }
	});
	return new S3ObjectStore(client, "media-bucket");
}

describe("S3ObjectStore", () => {
	beforeEach(() => {
		s3Mock.reset();
	});

	it("presigns a GET for the explicit bucket with the requested expiry", async () => {
		const url = await store().presignGet("source-bucket", "folder/source.mp4", 900);

		expect(url).toMatch(new RegExp(`^https://source-bucket\\.s3\\.${REGION}\\.amazonaws\\.com/folder/source\\.mp4\\?`));
		expect(url).toContain("X-Amz-Expires=900");
		expect(url).toContain("X-Amz-Signature=");
	});

	it("uploads a file to the media bucket and returns its size in bytes", async () => {
		s3Mock.on(PutObjectCommand).resolves({});

		const bytes = await store().uploadFile("acme/media/a1/a1_720.mp4", PACKAGE_JSON, "video/mp4");

		expect(bytes).toBe((await stat(PACKAGE_JSON)).size);
		expect(s3Mock.commandCall(0, PutObjectCommand).args[0].input).toMatchObject({
			Bucket: "media-bucket",
			Key: "acme/media/a1/a1_720.mp4",
			ContentType: "video/mp4"
		});
	});

	it("lists keys across every page", async () => {
		s3Mock.on(ListObjectsV2Command).callsFake((input) =>
			input.ContinuationToken === "page-2"
				? { Contents: [{ Key: "acme/media/a1/c.jpg" }] }
				: {
						Contents: [{ Key: "acme/media/a1/a.jpg" }, { Key: "acme/media/a1/b.jpg" }],
						NextContinuationToken: "page-2"
					}
		);

		expect(await store().listKeys("acme/media/a1/")).toEqual([
			"acme/media/a1/a.jpg",
			"acme/media/a1/b.jpg",
			"acme/media/a1/c.jpg"
		]);
		expect(s3Mock.commandCalls(ListObjectsV2Command)[0].args[0].input).toMatchObject({
			Bucket: "media-bucket",
			Prefix: "acme/media/a1/"
		});
	});

	it("deletes keys in batches of 1000", async () => {
		s3Mock.on(DeleteObjectsCommand).resolves({});
		const keys = Array.from({ length: 2500 }, (_, i) => `key-${i}`);

		await store().deleteKeys(keys);

		const batches = s3Mock.commandCalls(DeleteObjectsCommand).map((call) => call.args[0].input.Delete?.Objects);
		expect(batches.map((objects) => objects?.length)).toEqual([1000, 1000, 500]);
		expect(batches[2]?.[499]).toEqual({ Key: "key-2499" });
	});

	it("sends no request when there is nothing to delete", async () => {
		await store().deleteKeys([]);

		expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
	});

	it("fails when S3 reports a delete error", async () => {
		s3Mock.on(DeleteObjectsCommand).resolves({ Errors: [{ Key: "stuck", Code: "AccessDenied" }] });

		await expect(store().deleteKeys(["stuck"])).rejects.toThrow(/stuck/);
	});
});

describe("objectStore", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			AWS_ACCESS_KEY_ID: "test",
			AWS_SECRET_ACCESS_KEY: "test"
		};
		resetConfigForTests();
		resetObjectStoreForTests();
	});

	afterEach(() => {
		process.env = originalEnv;
		resetConfigForTests();
		resetObjectStoreForTests();
	});

	it("uses virtual-host URLs when no S3_ENDPOINT is set", async () => {
		const url = await objectStore().presignGet("source-bucket", "source.mp4", 60);

		expect(url).toMatch(/^https:\/\/source-bucket\.s3\./);
	});

	it("uses path-style URLs against S3_ENDPOINT", async () => {
		process.env.S3_ENDPOINT = "http://localhost:4566";
		resetConfigForTests();

		const url = await objectStore().presignGet("source-bucket", "source.mp4", 60);

		expect(url).toMatch(/^http:\/\/localhost:4566\/source-bucket\/source\.mp4\?/);
	});

	it("returns the same instance on repeated calls", () => {
		expect(objectStore()).toBe(objectStore());
	});
});
