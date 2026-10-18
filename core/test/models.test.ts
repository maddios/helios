import { apiKeys, ensureIndexes, PIPELINE_ITEM_TTL_SEC, requests } from "../src/models";
import { db } from "../src/db";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

const apiKey = {
	_id: "key-1",
	accountId: "account-1",
	name: "test",
	hash: "abc",
	prefix: "hel_",
	scope: "account" as const,
	createdAt: new Date()
};

describe("models", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
	});

	it("creates the pipeline_items TTL index", async () => {
		const indexes = await db().collection("pipeline_items").indexes();
		const ttl = indexes.find((index) => index.key.completedAt === 1);
		expect(ttl?.expireAfterSeconds).toBe(PIPELINE_ITEM_TTL_SEC);
		expect(PIPELINE_ITEM_TTL_SEC).toBe(30 * 24 * 60 * 60);
	});

	it("creates a unique api_keys hash index", async () => {
		const indexes = await db().collection("api_keys").indexes();
		const hashIndex = indexes.find((index) => index.key.hash === 1);
		expect(hashIndex?.unique).toBe(true);
	});

	it("rejects duplicate api_keys hashes", async () => {
		await apiKeys().insertOne(apiKey);
		await expect(apiKeys().insertOne({ ...apiKey, _id: "key-2" })).rejects.toThrow();
	});

	it("creates a unique per-account clientRequestId index on requests", async () => {
		const indexes = await requests().indexes();
		const requestIndex = indexes.find((index) => index.key.accountId === 1 && index.key.clientRequestId === 1);
		expect(requestIndex?.unique).toBe(true);
	});

	it("creates a unique transcripts index on asset, language and translation", async () => {
		const indexes = await db().collection("transcripts").indexes();
		const transcriptIndex = indexes.find((index) => index.key.assetId === 1 && index.key.isTranslation === 1);
		expect(transcriptIndex?.unique).toBe(true);
	});
});
