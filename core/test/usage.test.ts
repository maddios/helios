import type { ResourceUnits } from "@helios/contracts";
import { ensureIndexes, usageDaily, type UsageDaily } from "../src/models";
import { mongoKey } from "../src/pipeline";
import { decodeMongoKey, getAdminUsage, getUsage, zeroUnits } from "../src/usage";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

const GPT = mongoKey("gpt-4.1");

function usageDoc(accountId: string, date: string, requests: number, overrides: Partial<ResourceUnits>): UsageDaily {
	return { _id: `${accountId}:${date}`, accountId, date, requests, units: { ...zeroUnits(), ...overrides } };
}

describe("usage", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
	});

	describe("decodeMongoKey", () => {
		it("round-trips names containing %, . and $", () => {
			const name = "ft:gpt.4$%x";
			expect(mongoKey(name)).toBe("ft:gpt%2E4%24%25x");
			expect(decodeMongoKey(mongoKey(name))).toBe(name);
		});

		it("does not decode an escaped percent followed by encoded text", () => {
			expect(decodeMongoKey(mongoKey("a%2Eb"))).toBe("a%2Eb");
		});
	});

	describe("getUsage", () => {
		it("sums in-range days for one account and decodes model names", async () => {
			await usageDaily().insertMany([
				usageDoc("acc-1", "2026-03-01", 2, { outputGb: 1, llmTokens: { [GPT]: { input: 10, output: 5 } } }),
				usageDoc("acc-1", "2026-03-02", 3, { outputGb: 2, llmTokens: { [GPT]: { input: 20, output: 7 } } }),
				usageDoc("acc-1", "2026-04-01", 9, { outputGb: 9 }),
				usageDoc("acc-2", "2026-03-01", 4, { outputGb: 4 })
			]);

			const usage = await getUsage("acc-1", "2026-03-01", "2026-03-31");

			expect(usage.requests).toBe(5);
			expect(usage.units.outputGb).toBe(3);
			expect(usage.units.llmTokens).toEqual({ "gpt-4.1": { input: 30, output: 12 } });
			expect(usage.days.map((day) => day.date)).toEqual(["2026-03-01", "2026-03-02"]);
			expect(usage.days[0]?.units.llmTokens).toEqual({ "gpt-4.1": { input: 10, output: 5 } });
		});
	});

	describe("getAdminUsage", () => {
		it("groups accounts separately and excludes out-of-range days", async () => {
			await usageDaily().insertMany([
				usageDoc("acc-2", "2026-03-01", 4, { outputGb: 4 }),
				usageDoc("acc-1", "2026-03-01", 2, { outputGb: 1, llmTokens: { [GPT]: { input: 10, output: 5 } } }),
				usageDoc("acc-1", "2026-03-05", 1, { outputGb: 1, llmTokens: { [GPT]: { input: 1, output: 1 } } }),
				usageDoc("acc-2", "2026-05-01", 8, { outputGb: 8 })
			]);

			const usage = await getAdminUsage("2026-03-01", "2026-03-31");

			expect(usage.accounts.map((account) => account.accountId)).toEqual(["acc-1", "acc-2"]);
			expect(usage.accounts[0]).toEqual({
				accountId: "acc-1",
				requests: 3,
				units: { ...zeroUnits(), outputGb: 2, llmTokens: { "gpt-4.1": { input: 11, output: 6 } } }
			});
			expect(usage.accounts[1]?.requests).toBe(4);
		});
	});
});
