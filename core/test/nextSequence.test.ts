import { ensureIndexes, requests } from "../src/models";
import { nextSequence } from "../src/pipeline";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

const REQUEST_ID = "req-sequence";
const CONCURRENT_CALLS = 25;

describe("nextSequence", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await requests().insertOne({
			_id: REQUEST_ID,
			accountId: "account-1",
			assetId: "asset-1",
			clientRequestId: REQUEST_ID,
			mode: "purge",
			analyze: "sync",
			assetVersion: 1,
			pendingItems: [],
			status: "COMPLETE",
			createdAt: new Date()
		});
	});

	it("starts at 1 and increases by one per call", async () => {
		expect(await nextSequence(REQUEST_ID)).toBe(1);
		expect(await nextSequence(REQUEST_ID)).toBe(2);
	});

	it("returns unique numbers 1..n under concurrent calls", async () => {
		const values = await Promise.all(Array.from({ length: CONCURRENT_CALLS }, () => nextSequence(REQUEST_ID)));

		expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: CONCURRENT_CALLS }, (_, i) => i + 1));
	});

	it("throws when the request does not exist", async () => {
		await expect(nextSequence("missing")).rejects.toThrow("Request missing not found");
	});
});
