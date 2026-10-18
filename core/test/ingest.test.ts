import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resetConfigForTests } from "../src/config";
import { mediaAssets, type MediaAsset } from "../src/models";
import { ingestUrl } from "../src/ingest";
import { ResponseTooLargeError } from "../src/ssrf";
import { resetObjectStoreForTests } from "../src/storage";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

const s3Mock = mockClient(S3Client);
const SLUG = "acme";
const ASSET_ID = "0b1c2d3e-0000-4000-8000-000000000042";
const MAX_BYTES = 500;
const FILE_BYTES = 1000;

let server: Server;
let base: string;
let fileRequests = 0;

function respondWithFile(res: ServerResponse): void {
	fileRequests++;
	res.writeHead(200, { "content-type": "video/mp4", "content-length": String(FILE_BYTES) }).end("x".repeat(FILE_BYTES));
}

function respondChunked(res: ServerResponse): void {
	res.writeHead(200, { "content-type": "video/mp4" });
	for (let i = 0; i < 10; i++) {
		res.write("x".repeat(200));
	}
	res.end();
}

function urlAsset(url: string, ingestedKey?: string): MediaAsset {
	const now = new Date();
	return {
		_id: ASSET_ID,
		accountId: "acct-1",
		source: { type: "url", url, ...(ingestedKey === undefined ? {} : { ingestedKey }) },
		version: 1,
		outputs: {},
		createdAt: now,
		updatedAt: now
	};
}

async function storedAsset(): Promise<MediaAsset> {
	const doc = await mediaAssets().findOne({ _id: ASSET_ID });
	if (doc === null) {
		throw new Error("asset missing");
	}
	return doc;
}

describe("ingestUrl", () => {
	const originalEnv = process.env;

	beforeAll(async () => {
		await startMongo();
		server = createServer((req, res) => {
			if (req.url === "/file") {
				respondWithFile(res);
			} else if (req.url === "/chunked") {
				respondChunked(res);
			} else {
				res.writeHead(404).end();
			}
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		server.closeAllConnections();
		await new Promise<void>((done) => server.close(() => done()));
		await stopMongo();
	});

	beforeEach(async () => {
		process.env = {
			...originalEnv,
			AWS_ACCESS_KEY_ID: "test",
			AWS_SECRET_ACCESS_KEY: "test",
			SSRF_ALLOWED_HOSTS: "127.0.0.1"
		};
		resetConfigForTests();
		resetConfigForTests();
		resetObjectStoreForTests();
		s3Mock.reset();
		s3Mock.on(PutObjectCommand).resolves({});
		fileRequests = 0;
		await resetDb();
	});

	afterEach(() => {
		process.env = originalEnv;
		resetConfigForTests();
		resetConfigForTests();
		resetObjectStoreForTests();
	});

	it("streams the source into the sources key and persists source.ingestedKey", async () => {
		await mediaAssets().insertOne(urlAsset(`${base}/file`));

		const key = await ingestUrl(urlAsset(`${base}/file`), SLUG, { maxBytes: FILE_BYTES });

		expect(key).toBe(`${SLUG}/sources/${ASSET_ID}/original`);
		expect(s3Mock.commandCall(0, PutObjectCommand).args[0].input).toMatchObject({
			Key: key,
			ContentType: "application/octet-stream"
		});
		expect((await storedAsset()).source).toMatchObject({ type: "url", ingestedKey: key });
	});

	it("returns the persisted key without fetching when already ingested", async () => {
		const key = `${SLUG}/sources/${ASSET_ID}/original`;
		await mediaAssets().insertOne(urlAsset(`${base}/file`));
		await ingestUrl(await storedAsset(), SLUG, { maxBytes: FILE_BYTES });
		const requestsAfterFirst = fileRequests;

		const second = await ingestUrl(await storedAsset(), SLUG, { maxBytes: FILE_BYTES });

		expect(second).toBe(key);
		expect(fileRequests).toBe(requestsAfterFirst);
		expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
	});

	it("throws for a source that is not a URL", async () => {
		const asset = {
			...urlAsset(`${base}/file`),
			source: { type: "upload" as const, key: `${SLUG}/uploads/x/clip.mp4` }
		};

		await expect(ingestUrl(asset, SLUG, { maxBytes: FILE_BYTES })).rejects.toThrow("source is not a URL");
		expect(fileRequests).toBe(0);
	});

	it("rejects a body over maxBytes with ResponseTooLargeError and persists nothing", async () => {
		await mediaAssets().insertOne(urlAsset(`${base}/chunked`));

		await expect(ingestUrl(urlAsset(`${base}/chunked`), SLUG, { maxBytes: MAX_BYTES })).rejects.toBeInstanceOf(
			ResponseTooLargeError
		);
		expect((await storedAsset()).source).toEqual({ type: "url", url: `${base}/chunked` });
	});
});
