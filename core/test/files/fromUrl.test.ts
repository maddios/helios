import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mockClient } from "aws-sdk-client-mock";
import { createAccount } from "../../src/accounts";
import type { Account } from "../../src/models";
import { resetConfigForTests } from "../../src/config";
import { files, type FileRecord } from "../../src/models";
import { createFileFromUrl, ingestFileFromUrl } from "../../src/files";
import { resetObjectStoreForTests } from "../../src/storage";
import { resetDb, startMongo, stopMongo } from "../helpers/mongo";

const mockSend = jest.fn();

jest.mock("../../src/queue", () => ({
	...jest.requireActual("../../src/queue"),
	queueFor: jest.fn(() => ({ send: mockSend }))
}));

const s3Mock = mockClient(S3Client);
const PNG_BYTES = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
	Buffer.from("IHDR"),
	Buffer.from([0, 0, 0x01, 0x40, 0, 0, 0, 0x90, 8, 6, 0, 0, 0])
]);
const MAX_BYTES = 4096;

let server: Server;
let base: string;
let account: Account;

function respond(res: ServerResponse, contentType: string, body: Buffer | string): void {
	res.writeHead(200, { "content-type": contentType }).end(body);
}

async function fileOf(id: string): Promise<FileRecord> {
	const doc = await files().findOne({ _id: id });
	if (doc === null) {
		throw new Error("file missing");
	}
	return doc;
}

function sentBodies(): unknown[] {
	return mockSend.mock.calls.map(([message]) => message.body);
}

beforeAll(async () => {
	await startMongo();
	server = createServer((req, res) => {
		if (req.url === "/logo.png") {
			respond(res, "image/png", PNG_BYTES);
		} else if (req.url === "/notes.png") {
			respond(res, "image/png", "these are plain notes, not an image");
		} else if (req.url === "/huge.bin") {
			respond(res, "application/octet-stream", Buffer.alloc(MAX_BYTES * 2, 1));
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
		...process.env,
		AWS_ACCESS_KEY_ID: "test",
		AWS_SECRET_ACCESS_KEY: "test",
		SSRF_ALLOWED_HOSTS: "127.0.0.1"
	};
	resetConfigForTests();
	resetObjectStoreForTests();
	s3Mock.reset();
	s3Mock.on(PutObjectCommand).resolves({});
	s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
	s3Mock.on(DeleteObjectsCommand).resolves({ Errors: [] });
	mockSend.mockReset();
	await resetDb();
	account = await createAccount({
		slug: "acme",
		name: "Acme",
		sourceBuckets: [],
		features: { peopleAttributes: false },
		uploadPolicy: { allowedContentTypes: ["image/*"], maxBytes: MAX_BYTES }
	});
});

describe("createFileFromUrl", () => {
	it("creates a PENDING file named after the URL and queues its ingest on the AI tier", async () => {
		const created = await createFileFromUrl(account, { url: `${base}/logo.png`, externalId: "logo-1" });

		expect(created).toMatchObject({ status: "PENDING", source: "url", filename: "logo.png", externalId: "logo-1" });
		expect(created.expiresAt).toBeInstanceOf(Date);
		expect(mockSend).toHaveBeenCalledWith({ body: { fileId: created._id } });
		expect((await fileOf(created._id)).sourceUrl).toBe(`${base}/logo.png`);
	});
});

describe("ingestFileFromUrl", () => {
	it("stores the fetched file with the sniffed type and notifies file.stored", async () => {
		const created = await createFileFromUrl(account, { url: `${base}/logo.png` });

		await ingestFileFromUrl(created._id);

		const stored = await fileOf(created._id);
		expect(stored).toMatchObject({ status: "STORED", contentType: "image/png", sizeBytes: PNG_BYTES.length });
		expect(stored.image).toEqual({ width: 320, height: 144, format: "png" });
		expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input).toMatchObject({
			Key: stored.key,
			ContentType: "image/png"
		});
		expect(sentBodies()).toContainEqual({
			type: "file",
			accountId: account._id,
			fileId: created._id,
			event: "file.stored",
			sequence: 1
		});
	});

	it("fails a file whose bytes are not the image its URL promises, without storing anything", async () => {
		const created = await createFileFromUrl(account, { url: `${base}/notes.png` });

		await ingestFileFromUrl(created._id);

		expect(await fileOf(created._id)).toMatchObject({ status: "FAILED", error: expect.stringMatching(/not allowed/) });
		expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
		expect(sentBodies()).toContainEqual(
			expect.objectContaining({ type: "file", fileId: created._id, event: "file.failed" })
		);
	});

	it("fails a body over the account's maxBytes with a too_large error", async () => {
		const created = await createFileFromUrl(account, { url: `${base}/huge.bin` });

		await ingestFileFromUrl(created._id);

		expect(await fileOf(created._id)).toMatchObject({ status: "FAILED", error: expect.stringMatching(/exceeds/) });
	});

	it("fails a URL that resolves to a private address through the SSRF guard", async () => {
		process.env.SSRF_ALLOWED_HOSTS = "";
		resetConfigForTests();
		const created = await createFileFromUrl(account, { url: "http://10.0.0.1/logo.png" });

		await ingestFileFromUrl(created._id);

		expect(await fileOf(created._id)).toMatchObject({ status: "FAILED" });
		expect(sentBodies()).toContainEqual(expect.objectContaining({ event: "file.failed" }));
	});

	it("fails a file that the server answers with an error status", async () => {
		const created = await createFileFromUrl(account, { url: `${base}/missing.png` });

		await ingestFileFromUrl(created._id);

		expect(await fileOf(created._id)).toMatchObject({ status: "FAILED", error: expect.stringMatching(/status 404/) });
	});

	it("does nothing for a file that is no longer pending", async () => {
		const created = await createFileFromUrl(account, { url: `${base}/logo.png` });
		await ingestFileFromUrl(created._id);
		mockSend.mockClear();

		await ingestFileFromUrl(created._id);

		expect(mockSend).not.toHaveBeenCalled();
		expect((await fileOf(created._id)).status).toBe("STORED");
	});
});
