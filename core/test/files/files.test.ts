import {
	DeleteObjectsCommand,
	ListObjectsV2Command,
	S3Client,
	GetObjectCommand,
	HeadObjectCommand
} from "@aws-sdk/client-s3";
import { NotFoundError, UnprocessableError } from "@helios/contracts";
import { mockClient } from "aws-sdk-client-mock";
import { createAccount } from "../../src/accounts";
import type { Account } from "../../src/models";
import { cdnInvalidations } from "../../src/models";
import { files, type FileRecord } from "../../src/models";
import { deleteFile, listFiles, loadFile, loadStoredFile, toFileView } from "../../src/files";
import { toAssetSource } from "../../src/intake/sourceAsset";
import { resetObjectStoreForTests } from "../../src/storage";
import { resetDb, startMongo, stopMongo } from "../helpers/mongo";

const s3Mock = mockClient(S3Client);
const FILE_ID = "0b1c2d3e-0000-4000-8000-000000000101";
const OTHER_ID = "0b1c2d3e-0000-4000-8000-000000000102";

let account: Account;

function record(overrides: Partial<FileRecord> = {}): FileRecord {
	return {
		_id: FILE_ID,
		accountId: account._id,
		key: `acme/files/${FILE_ID}/logo.png`,
		filename: "logo.png",
		status: "STORED",
		source: "upload",
		policy: { allowedContentTypes: ["*/*"], maxBytes: 1024 * 1024 },
		contentType: "image/png",
		sizeBytes: 29,
		image: { width: 320, height: 144, format: "png" },
		externalId: "logo-1",
		createdAt: new Date("2026-10-19T09:00:00Z"),
		storedAt: new Date("2026-10-19T09:00:04Z"),
		...overrides
	};
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
});

describe("toFileView", () => {
	it("builds the CDN url with the stored time as version and keeps the image dimensions", () => {
		expect(toFileView(record())).toMatchObject({
			id: FILE_ID,
			url: `${process.env.CDN_BASE_URL}/acme/files/${FILE_ID}/logo.png?v=${Date.parse("2026-10-19T09:00:04Z") / 1000}`,
			status: "STORED",
			contentType: "image/png",
			image: { width: 320, height: 144, format: "png" },
			externalId: "logo-1",
			storedAt: "2026-10-19T09:00:04.000Z"
		});
	});

	it("omits the version of a pending file and never exposes its source url", () => {
		const view = toFileView(
			record({ status: "PENDING", storedAt: undefined, sourceUrl: "https://example.test/x?token=1" })
		);

		expect(view.url).not.toContain("?v=");
		expect(JSON.stringify(view)).not.toContain("token");
	});
});

describe("listFiles", () => {
	it("lists files newest first and pages with a cursor", async () => {
		await files().insertMany([
			record({ _id: FILE_ID, createdAt: new Date("2026-10-19T09:00:00Z") }),
			record({ _id: OTHER_ID, createdAt: new Date("2026-10-19T10:00:00Z"), key: `acme/files/${OTHER_ID}/logo.png` })
		]);

		const first = await listFiles(account._id, { limit: 1 });
		const second = await listFiles(account._id, { limit: 1, cursor: first.nextCursor });

		expect(first.docs.map((doc) => doc._id)).toEqual([OTHER_ID]);
		expect(second.docs.map((doc) => doc._id)).toEqual([FILE_ID]);
		expect(second.nextCursor).toBeUndefined();
	});

	it("filters by externalId and by content type prefix, and hides deleted files", async () => {
		await files().insertMany([
			record({ _id: FILE_ID, externalId: "a", contentType: "image/png" }),
			record({ _id: OTHER_ID, externalId: "b", contentType: "video/mp4", key: `acme/files/${OTHER_ID}/clip.mp4` }),
			record({
				_id: "0b1c2d3e-0000-4000-8000-000000000103",
				externalId: "a",
				contentType: "image/jpeg",
				deletedAt: new Date(),
				key: "acme/files/x/y.jpg"
			})
		]);

		expect((await listFiles(account._id, { externalId: "a" })).docs.map((doc) => doc._id)).toEqual([FILE_ID]);
		expect((await listFiles(account._id, { contentTypePrefix: "video/" })).docs.map((doc) => doc._id)).toEqual([
			OTHER_ID
		]);
	});
});

describe("deleteFile", () => {
	it("deletes the object and its resize_cache variants, enqueues a CDN invalidation and tombstones the record", async () => {
		await files().insertOne(record());
		s3Mock
			.on(ListObjectsV2Command)
			.resolves({ Contents: [{ Key: `resize_cache/acme/files/${FILE_ID}/logo.png/_img/w_100` }] });
		s3Mock.on(DeleteObjectsCommand).resolves({ Errors: [] });

		await deleteFile(account._id, FILE_ID);

		expect(s3Mock.commandCalls(ListObjectsV2Command)[0].args[0].input.Prefix).toBe(
			`resize_cache/acme/files/${FILE_ID}/logo.png/`
		);
		expect(s3Mock.commandCalls(DeleteObjectsCommand)[0].args[0].input.Delete?.Objects).toEqual([
			{ Key: `acme/files/${FILE_ID}/logo.png` },
			{ Key: `resize_cache/acme/files/${FILE_ID}/logo.png/_img/w_100` }
		]);
		expect(await cdnInvalidations().findOne({ _id: `file-delete:${FILE_ID}` })).toMatchObject({
			paths: [`/acme/files/${FILE_ID}/*`],
			status: "PENDING"
		});
		await expect(loadFile(account._id, FILE_ID)).rejects.toThrow(NotFoundError);
	});

	it("reports a file that does not exist or belongs to another account as not found", async () => {
		await expect(deleteFile(account._id, OTHER_ID)).rejects.toThrow(NotFoundError);
	});
});

describe("toAssetSource with a fileId", () => {
	it("reads a stored file in place, recording its id and key", async () => {
		await files().insertOne(record());

		await expect(toAssetSource(account, { fileId: FILE_ID })).resolves.toEqual({
			type: "file",
			fileId: FILE_ID,
			key: `acme/files/${FILE_ID}/logo.png`
		});
	});

	it("refuses a file that is not stored, with 422 file_not_stored", async () => {
		await files().insertOne(record({ status: "PENDING", storedAt: undefined }));

		await expect(toAssetSource(account, { fileId: FILE_ID })).rejects.toMatchObject({
			httpStatus: 422,
			code: "file_not_stored"
		});
		await expect(loadStoredFile(account._id, FILE_ID)).rejects.toThrow(UnprocessableError);
	});

	it("does not resolve another account's file", async () => {
		const other = await createAccount({
			slug: "globex",
			name: "Globex",
			sourceBuckets: [],
			features: { peopleAttributes: false }
		});
		await files().insertOne(record({ accountId: other._id }));

		await expect(toAssetSource(account, { fileId: FILE_ID })).rejects.toThrow(NotFoundError);
		s3Mock.on(HeadObjectCommand).resolves({});
		s3Mock.on(GetObjectCommand).resolves({});
		expect(s3Mock.calls()).toHaveLength(0);
	});
});

describe("file record shape", () => {
	it("keeps the file's policy so a later check uses the policy it was accepted under", async () => {
		await files().insertOne(record());

		expect((await files().findOne({ _id: FILE_ID }))?.policy.maxBytes).toBe(1024 * 1024);
	});
});
