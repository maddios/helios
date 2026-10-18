import { ConflictError, NotFoundError, UnauthorizedError } from "@helios/contracts";
import { ApiKeySchema, apiKeys, ensureIndexes } from "../src/models";
import { authenticate, bootstrapAdminKey, createApiKey, generateKey, hashKey, revokeApiKey } from "../src/apiKeys";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

const T0 = new Date("2026-01-01T00:00:00Z");
const SECOND = 1_000;

describe("apiKeys", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
	});

	describe("generateKey", () => {
		it("prefixes keys by scope with 32 base62 characters", () => {
			expect(generateKey("account")).toMatch(/^sk_live_[0-9A-Za-z]{32}$/);
			expect(generateKey("admin")).toMatch(/^sk_admin_[0-9A-Za-z]{32}$/);
		});

		it("generates distinct keys", () => {
			expect(generateKey("account")).not.toBe(generateKey("account"));
		});
	});

	describe("hashKey", () => {
		it("returns the sha256 hex digest", () => {
			expect(hashKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		});
	});

	describe("ApiKeySchema", () => {
		const base = { _id: "key-1", name: "n", hash: "h", prefix: "sk_live_abcd", createdAt: T0 };

		it("rejects account keys without accountId", () => {
			expect(ApiKeySchema.safeParse({ ...base, scope: "account" }).success).toBe(false);
		});

		it("accepts admin keys without accountId", () => {
			expect(ApiKeySchema.safeParse({ ...base, scope: "admin" }).success).toBe(true);
		});
	});

	describe("createApiKey", () => {
		it("stores only the hash and prefix of an account key", async () => {
			const { key, record } = await createApiKey({ scope: "account", accountId: "account-1", name: "web" });
			const stored = await apiKeys().findOne({ _id: record._id });
			expect(stored?.accountId).toBe("account-1");
			expect(stored?.hash).toBe(hashKey(key));
			expect(stored?.prefix).toBe(key.slice(0, 12));
			expect(JSON.stringify(stored)).not.toContain(key);
		});

		it("creates admin keys without an accountId", async () => {
			const { record } = await createApiKey({ scope: "admin", name: "ops" });
			const stored = await apiKeys().findOne({ _id: record._id });
			expect(stored).not.toHaveProperty("accountId");
			expect(stored?.scope).toBe("admin");
		});

		it("returns a key that authenticates", async () => {
			const { key, record } = await createApiKey({ scope: "account", accountId: "account-1", name: "web" });
			expect((await authenticate(key))._id).toBe(record._id);
		});
	});

	describe("authenticate", () => {
		it("rejects unknown keys", async () => {
			await expect(authenticate("sk_live_unknown")).rejects.toThrow(UnauthorizedError);
		});

		it("rejects revoked keys", async () => {
			const { key, record } = await createApiKey({ scope: "account", accountId: "account-1", name: "web" });
			await revokeApiKey("account-1", record._id);
			await expect(authenticate(key)).rejects.toThrow(UnauthorizedError);
		});

		it("throttles lastUsedAt updates to once per minute", async () => {
			const { key, record } = await createApiKey({ scope: "account", accountId: "account-1", name: "web" });
			const storedLastUsed = async () => (await apiKeys().findOne({ _id: record._id }))?.lastUsedAt;

			await authenticate(key, T0);
			expect(await storedLastUsed()).toEqual(T0);

			await authenticate(key, new Date(T0.getTime() + 10 * SECOND));
			expect(await storedLastUsed()).toEqual(T0);

			await authenticate(key, new Date(T0.getTime() + 61 * SECOND));
			expect(await storedLastUsed()).toEqual(new Date(T0.getTime() + 61 * SECOND));
		});
	});

	describe("revokeApiKey", () => {
		it("revokes the key for its owning account", async () => {
			const { key, record } = await createApiKey({ scope: "account", accountId: "account-1", name: "web" });
			await revokeApiKey("account-1", record._id);
			await expect(authenticate(key)).rejects.toThrow(UnauthorizedError);
		});

		it("rejects a different accountId", async () => {
			const { record } = await createApiKey({ scope: "account", accountId: "account-1", name: "web" });
			await expect(revokeApiKey("account-2", record._id)).rejects.toThrow(NotFoundError);
		});

		it("rejects keys that are already revoked", async () => {
			const { record } = await createApiKey({ scope: "account", accountId: "account-1", name: "web" });
			await revokeApiKey("account-1", record._id);
			await expect(revokeApiKey("account-1", record._id)).rejects.toThrow(NotFoundError);
		});
	});

	describe("bootstrapAdminKey", () => {
		it("creates one admin key and refuses a second", async () => {
			const key = await bootstrapAdminKey();
			expect(key).toMatch(/^sk_admin_/);
			await expect(bootstrapAdminKey()).rejects.toThrow(ConflictError);
		});
	});
});
