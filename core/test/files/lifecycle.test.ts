import {
	AbortMultipartUploadCommand,
	DeleteObjectsCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	S3Client,
	S3ServiceException
} from "@aws-sdk/client-s3";
import { NotFoundError } from "@helios/contracts";
import { mockClient } from "aws-sdk-client-mock";
import { createAccount } from "../../src/accounts";
import {
	files,
	mediaAssets,
	requests,
	type Account,
	type FileRecord,
	type MediaAsset,
	type PipelineRequest
} from "../../src/models";
import { completeUpload, abortUpload, listUploadParts, signUploadParts } from "../../src/uploads";
import { deleteFile, expirePendingFiles, failDeadFile, loadFile, markFailed, markStored } from "../../src/files";
import { resetObjectStoreForTests } from "../../src/storage";
import { resetDb, startMongo, stopMongo } from "../helpers/mongo";

const mockSend = jest.fn();

jest.mock("../../src/queue", () => ({
	...jest.requireActual("../../src/queue"),
	queueFor: jest.fn(() => ({ send: mockSend }))
}));

const s3Mock = mockClient(S3Client);
const FILE_ID = "0b1c2d3e-0000-4000-8000-000000000301";
const URL_FILE_ID = "0b1c2d3e-0000-4000-8000-000000000302";
const PAST = new Date("2020-01-01T00:00:00Z");

let account: Account;

function fileOf(overrides: Partial<FileRecord> = {}): FileRecord {
	return {
		_id: FILE_ID,
		accountId: account._id,
		key: `acme/files/${FILE_ID}/clip.mp4`,
		filename: "clip.mp4",
		status: "PENDING",
		source: "upload",
		policy: { allowedContentTypes: ["*/*"], maxBytes: 1024 * 1024 },
		declaredContentType: "video/mp4",
		declaredSizeBytes: 29,
		expiresAt: new Date("2099-01-01T00:00:00Z"),
		createdAt: new Date("2026-10-19T09:00:00Z"),
		...overrides
	};
}

function noSuchKey(): S3ServiceException {
	return new S3ServiceException({
		name: "NotFound",
		message: "missing",
		$fault: "client",
		$metadata: { httpStatusCode: 404 }
	});
}

/** Storage that has no object and nothing to list or delete, unless a test stubs more. */
function stubEmptyStorage(): void {
	s3Mock.on(HeadObjectCommand).rejects(noSuchKey());
	s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
	s3Mock.on(DeleteObjectsCommand).resolves({ Errors: [] });
	s3Mock.on(AbortMultipartUploadCommand).resolves({});
}

function sentEvents(): unknown[] {
	return mockSend.mock.calls.map(([message]) => message.body);
}

beforeAll(() => startMongo());
afterAll(() => stopMongo());
beforeEach(async () => {
	process.env.AWS_ACCESS_KEY_ID = "test";
	process.env.AWS_SECRET_ACCESS_KEY = "test";
	await resetDb();
	resetObjectStoreForTests();
	s3Mock.reset();
	stubEmptyStorage();
	account = await createAccount({
		slug: "acme",
		name: "Acme",
		sourceBuckets: [],
		features: { peopleAttributes: false }
	});
});

describe("delete against complete, ingest and expiry", () => {
	it("claims the delete first, so a complete that follows is told the file is gone", async () => {
		await files().insertOne(fileOf());

		await deleteFile(account._id, FILE_ID);

		await expect(completeUpload(account, FILE_ID, undefined)).rejects.toThrow(NotFoundError);
	});

	it("makes a complete that was reading the file lose: markStored and markFailed match nothing after a delete", async () => {
		const read = fileOf();
		await files().insertOne(read);
		await deleteFile(account._id, FILE_ID);

		await expect(markStored(read, { contentType: "video/mp4", sizeBytes: 29 })).resolves.toBeUndefined();
		await expect(markFailed(read, "late")).resolves.toBe(false);
		expect(await files().findOne({ _id: FILE_ID })).toMatchObject({ status: "PENDING", deletedAt: expect.any(Date) });
	});

	it("answers 409 file_in_use and keeps the file when a non-terminal request reads it", async () => {
		await files().insertOne(
			fileOf({ status: "STORED", storedAt: new Date(), contentType: "video/mp4", sizeBytes: 29 })
		);
		await mediaAssets().insertOne({
			_id: "asset-1",
			accountId: account._id,
			source: { type: "file", fileId: FILE_ID, key: `acme/files/${FILE_ID}/clip.mp4` }
		} as MediaAsset);
		await requests().insertOne({
			_id: "req-1",
			accountId: account._id,
			assetId: "asset-1",
			status: "IN_PROGRESS"
		} as PipelineRequest);

		await expect(deleteFile(account._id, FILE_ID)).rejects.toMatchObject({ code: "file_in_use", httpStatus: 409 });

		expect(await loadFile(account._id, FILE_ID)).toMatchObject({ status: "STORED" });
		expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
	});

	it("lets a file be deleted once the request that read it has finished", async () => {
		await files().insertOne(
			fileOf({ status: "STORED", storedAt: new Date(), contentType: "video/mp4", sizeBytes: 29 })
		);
		await mediaAssets().insertOne({
			_id: "asset-2",
			accountId: account._id,
			source: { type: "file", fileId: FILE_ID, key: `acme/files/${FILE_ID}/clip.mp4` }
		} as MediaAsset);
		await requests().insertOne({
			_id: "req-2",
			accountId: account._id,
			assetId: "asset-2",
			status: "COMPLETE"
		} as PipelineRequest);

		await deleteFile(account._id, FILE_ID);

		await expect(loadFile(account._id, FILE_ID)).rejects.toThrow(NotFoundError);
	});
});

describe("abort against complete", () => {
	it("makes a complete after an abort answer 409 upload_failed", async () => {
		await files().insertOne(fileOf({ uploadId: "up-1", partCount: 1 }));

		await abortUpload(account._id, FILE_ID);

		await expect(completeUpload(account, FILE_ID, [{ partNumber: 1, etag: "e" }])).rejects.toMatchObject({
			httpStatus: 409,
			code: "upload_failed"
		});
	});

	it("makes an abort after a complete answer 409 and leaves the stored file", async () => {
		await files().insertOne(
			fileOf({ status: "STORED", storedAt: new Date(), contentType: "video/mp4", sizeBytes: 29 })
		);

		await expect(abortUpload(account._id, FILE_ID)).rejects.toMatchObject({
			httpStatus: 409,
			code: "upload_not_pending"
		});
		expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
	});
});

describe("expiry", () => {
	it("keeps going past a file whose release fails, and sends file.failed for an expired url file", async () => {
		await files().insertMany([
			fileOf({ expiresAt: PAST }),
			fileOf({
				_id: URL_FILE_ID,
				source: "url",
				sourceUrl: "https://example.test/a.mp4",
				key: `acme/files/${URL_FILE_ID}/a.mp4`,
				expiresAt: PAST
			})
		]);
		s3Mock.on(DeleteObjectsCommand).rejectsOnce(new Error("s3 is down")).resolves({ Errors: [] });

		await expect(expirePendingFiles(new Date())).resolves.toBeUndefined();

		expect((await files().find({}).toArray()).map((file) => file.status)).toEqual(["FAILED", "FAILED"]);
		expect(sentEvents()).toEqual([expect.objectContaining({ event: "file.failed", fileId: URL_FILE_ID })]);
	});

	it("does not expire a file that was deleted", async () => {
		await files().insertOne(fileOf({ expiresAt: PAST, deletedAt: new Date() }));

		await expirePendingFiles(new Date());

		expect(await files().findOne({ _id: FILE_ID })).toMatchObject({ status: "PENDING" });
		expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
	});
});

describe("dead-lettered ingest", () => {
	it("marks an undelivered url file FAILED once, and a second dead letter changes nothing", async () => {
		await files().insertOne(
			fileOf({
				_id: URL_FILE_ID,
				source: "url",
				sourceUrl: "https://example.test/a.mp4",
				key: `acme/files/${URL_FILE_ID}/a.mp4`
			})
		);

		await failDeadFile(URL_FILE_ID);
		await failDeadFile(URL_FILE_ID);

		expect(await files().findOne({ _id: URL_FILE_ID })).toMatchObject({ status: "FAILED" });
		expect(sentEvents()).toEqual([expect.objectContaining({ event: "file.failed", fileId: URL_FILE_ID })]);
	});

	it("leaves a stored file alone", async () => {
		await files().insertOne(
			fileOf({
				_id: URL_FILE_ID,
				source: "url",
				status: "STORED",
				storedAt: new Date(),
				contentType: "video/mp4",
				sizeBytes: 29
			})
		);

		await failDeadFile(URL_FILE_ID);

		expect(await files().findOne({ _id: URL_FILE_ID })).toMatchObject({ status: "STORED" });
		expect(mockSend).not.toHaveBeenCalled();
	});
});

describe("cross-account access", () => {
	it("does not let another account complete, list the parts of, re-sign or abort a file", async () => {
		const other = await createAccount({
			slug: "globex",
			name: "Globex",
			sourceBuckets: [],
			features: { peopleAttributes: false }
		});
		await files().insertOne(fileOf({ uploadId: "up-1", partCount: 2 }));

		await expect(completeUpload(other, FILE_ID, [{ partNumber: 1, etag: "e" }])).rejects.toThrow(NotFoundError);
		await expect(listUploadParts(other._id, FILE_ID)).rejects.toThrow(NotFoundError);
		await expect(signUploadParts(other, FILE_ID, [1])).rejects.toThrow(NotFoundError);
		await expect(abortUpload(other._id, FILE_ID)).rejects.toThrow(NotFoundError);
		expect(s3Mock.commandCalls(AbortMultipartUploadCommand)).toHaveLength(0);
	});
});
