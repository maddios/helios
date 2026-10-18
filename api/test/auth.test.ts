import request from "supertest";
import { apiKeys, ensureIndexes, MongoNetworkError, revokeApiKey } from "@helios/core";
import * as usage from "../../core/src/usage/getUsage";
import { createApp } from "../src/app";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { bearer, seedAccount, seedAdminKey, seedGenericPreset } from "./helpers/fixtures";
import { mockObjectStore } from "./helpers/apiMocks";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));

const app = createApp();
const USAGE = "/usage?from=2026-10-01&to=2026-10-02";

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
	await seedGenericPreset();
	mockObjectStore();
});

describe("authentication", () => {
	it("returns 401 when the Authorization header is missing", async () => {
		const res = await request(app).get(USAGE);

		expect(res.status).toBe(401);
		expect(res.body.error).toMatchObject({ code: "unauthorized" });
	});

	it("returns 401 for an unknown key", async () => {
		const res = await request(app).get(USAGE).set("Authorization", bearer("sk_live_unknown"));

		expect(res.status).toBe(401);
	});

	it("returns 401 for a revoked key", async () => {
		const { accountId, key } = await seedAccount();
		const record = await apiKeys().findOne({ prefix: key.slice(0, 12) });
		if (record === null) {
			throw new Error("seeded key not found");
		}
		await revokeApiKey(accountId, record._id);

		const res = await request(app).get(USAGE).set("Authorization", bearer(key));

		expect(res.status).toBe(401);
	});

	it("accepts a valid account key", async () => {
		const { key } = await seedAccount();

		const res = await request(app).get(USAGE).set("Authorization", bearer(key));

		expect(res.status).toBe(200);
	});

	it("returns 403 when an account key calls an admin route", async () => {
		const { key } = await seedAccount();

		const res = await request(app).get("/admin/accounts").set("Authorization", bearer(key));

		expect(res.status).toBe(403);
		expect(res.body.error.code).toBe("forbidden");
	});

	it("returns 403 when an admin key calls an account route", async () => {
		const adminKey = await seedAdminKey();

		const res = await request(app).get(USAGE).set("Authorization", bearer(adminKey));

		expect(res.status).toBe(403);
	});

	it("serves health without authentication", async () => {
		const res = await request(app).get("/health");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ status: "ok" });
	});

	it("requires a key for /openapi.json and /docs", async () => {
		const openApi = await request(app).get("/openapi.json");
		const docs = await request(app).get("/docs/");

		expect(openApi.status).toBe(401);
		expect(docs.status).toBe(401);
	});

	it("serves /openapi.json and /docs to an account key or an admin key", async () => {
		const { key } = await seedAccount();
		const adminKey = await seedAdminKey();

		const byAccount = await request(app).get("/docs/").set("Authorization", bearer(key));
		const byAdmin = await request(app).get("/openapi.json").set("Authorization", bearer(adminKey));

		expect(byAccount.status).toBe(200);
		expect(byAdmin.status).toBe(200);
	});

	it("rejects an unrecognised Authorization scheme with 401", async () => {
		const { key } = await seedAccount();

		const res = await request(app).get(USAGE).set("Authorization", `Basic ${key}`);

		expect(res.status).toBe(401);
	});

	it("accepts the Bearer scheme in any letter case", async () => {
		const { key } = await seedAccount();

		const res = await request(app).get(USAGE).set("Authorization", `bearer ${key}`);

		expect(res.status).toBe(200);
	});
});

describe("database unavailability", () => {
	it("answers 503 with Retry-After on an account route", async () => {
		const { key } = await seedAccount();
		jest.spyOn(usage, "getUsage").mockRejectedValue(new MongoNetworkError("connection refused"));

		const res = await request(app).get(USAGE).set("Authorization", bearer(key));

		expect(res.status).toBe(503);
		expect(res.headers["retry-after"]).toBe("5");
		expect(res.body.error.code).toBe("service_unavailable");
		jest.restoreAllMocks();
	});
});

describe("validation and errors", () => {
	it("returns 400 validation_failed with zod issues for an invalid body", async () => {
		const { key } = await seedAccount();

		const res = await request(app).post("/encode").set("Authorization", bearer(key)).send({ preset: "generic" });

		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe("validation_failed");
		expect(Array.isArray(res.body.error.details)).toBe(true);
		expect(res.body.error.details[0]).toHaveProperty("path");
	});

	it("returns 400 for an invalid query value", async () => {
		const { key } = await seedAccount();

		const res = await request(app).get("/usage?from=yesterday&to=today").set("Authorization", bearer(key));

		expect(res.status).toBe(400);
	});

	it("returns 400 for malformed JSON", async () => {
		const { key } = await seedAccount();

		const res = await request(app)
			.post("/encode")
			.set("Authorization", bearer(key))
			.set("Content-Type", "application/json")
			.send("{not json");

		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe("invalid_body");
	});

	it("returns 404 for unknown routes and echoes a correlation id", async () => {
		const res = await request(app).get("/nope").set("x-request-id", "trace-123");

		expect(res.status).toBe(404);
		expect(res.body.error.code).toBe("not_found");
		expect(res.headers["x-request-id"]).toBe("trace-123");
		expect(res.body.error.requestId).toBe("trace-123");
	});

	it("generates a correlation id when none is sent", async () => {
		const res = await request(app).get("/health");

		expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
	});
});
