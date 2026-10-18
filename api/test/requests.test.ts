import request from "supertest";
import { randomUUID } from "node:crypto";
import { ensureIndexes } from "@helios/core";
import { probeSource } from "../../core/src/analyze/probe";
import { createApp } from "../src/app";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { videoSource } from "../../core/test/helpers/pipelineFixtures";
import { bearer, seedAccount, seedAsset, seedGenericPreset, seedRequest } from "./helpers/fixtures";
import { mockObjectStore } from "./helpers/apiMocks";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));
jest.mock("../../core/src/analyze/probe", () => ({ probeSource: jest.fn() }));

const app = createApp();
let key: string;
let accountId: string;

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
	await seedGenericPreset();
	mockObjectStore();
	({ key, accountId } = await seedAccount());
});

async function encodeSync(): Promise<string> {
	jest.mocked(probeSource).mockResolvedValue(videoSource);
	const res = await request(app)
		.post("/encode")
		.set("Authorization", bearer(key))
		.send({ source: { bucket: "bucket-a", key: "a.mp4" }, preset: "generic", analyze: "sync" });
	return res.body.id;
}

describe("requests", () => {
	it("gets a request with its items and progress", async () => {
		const id = await encodeSync();

		const res = await request(app).get(`/requests/${id}`).set("Authorization", bearer(key));

		expect(res.status).toBe(200);
		expect(res.body.items.length).toBeGreaterThan(0);
		expect(res.body.items[0]).toMatchObject({ id: expect.stringContaining(id), key: expect.any(String) });
		expect(res.body.progress).toMatchObject({ total: res.body.items.length, finished: 0 });
		expect(res.body.postProcess).toMatchObject({ sceneDetection: true, transcribe: { translateToEnglish: true } });
	});

	it("returns 404 for another account's request", async () => {
		const asset = await seedAsset(randomUUID());
		const other = await seedRequest(asset.accountId, asset._id);

		const res = await request(app).get(`/requests/${other._id}`).set("Authorization", bearer(key));

		expect(res.status).toBe(404);
	});

	it("cancels an in-flight request with 200", async () => {
		const id = await encodeSync();

		const res = await request(app).delete(`/requests/${id}`).set("Authorization", bearer(key));

		expect(res.status).toBe(200);
		expect(res.body.status).toBe("CANCELLED");
		expect(res.body.progress.pending).toBe(0);
	});

	it("refuses to cancel a purge request with 409", async () => {
		const asset = await seedAsset(accountId);
		const purge = await seedRequest(accountId, asset._id, { mode: "purge", status: "IN_PROGRESS" });

		const res = await request(app).delete(`/requests/${purge._id}`).set("Authorization", bearer(key));

		expect(res.status).toBe(409);
		expect(res.body.error.code).toBe("purge_not_cancellable");
	});

	it("lists callback deliveries and never exposes the webhook secret", async () => {
		const asset = await seedAsset(accountId);
		const finished = await seedRequest(accountId, asset._id);

		const res = await request(app).get(`/requests/${finished._id}/callbacks`).set("Authorization", bearer(key));

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ deliveries: [] });
		expect(JSON.stringify(res.body)).not.toMatch(/webhookSecret|whsec_/);
	});

	it("redelivers a finished request's callback with 202 and refuses an open one with 409", async () => {
		const asset = await seedAsset(accountId);
		const done = await seedRequest(accountId, asset._id, { status: "COMPLETE" });
		const open = await seedRequest(accountId, asset._id, { status: "IN_PROGRESS" });

		const accepted = await request(app)
			.post(`/requests/${done._id}/callbacks/redeliver`)
			.set("Authorization", bearer(key));
		const conflict = await request(app)
			.post(`/requests/${open._id}/callbacks/redeliver`)
			.set("Authorization", bearer(key));

		expect(accepted.status).toBe(202);
		expect(accepted.body).toEqual({ requestId: done._id });
		expect(conflict.status).toBe(409);
	});
});

describe("redelivery cooldown", () => {
	it("answers 429 with Retry-After for a redelivery inside the cooldown", async () => {
		const asset = await seedAsset(accountId);
		const done = await seedRequest(accountId, asset._id, { status: "COMPLETE" });
		const path = `/requests/${done._id}/callbacks/redeliver`;

		const first = await request(app).post(path).set("Authorization", bearer(key));
		const second = await request(app).post(path).set("Authorization", bearer(key));

		expect(first.status).toBe(202);
		expect(second.status).toBe(429);
		expect(second.body.error.code).toBe("redeliver_cooldown");
		expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
	});
});

describe("usage", () => {
	it("rejects a range that ends before it starts, or spans more than 366 days", async () => {
		const reversed = await request(app).get("/usage?from=2026-10-02&to=2026-10-01").set("Authorization", bearer(key));
		const tooLong = await request(app).get("/usage?from=2026-01-01&to=2027-01-03").set("Authorization", bearer(key));
		const maximal = await request(app).get("/usage?from=2026-01-01&to=2027-01-02").set("Authorization", bearer(key));

		expect(reversed.status).toBe(400);
		expect(tooLong.status).toBe(400);
		expect(maximal.status).toBe(200);
	});

	it("returns zeroed totals for a range without usage", async () => {
		const res = await request(app).get("/usage?from=2026-10-01&to=2026-10-02").set("Authorization", bearer(key));

		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ from: "2026-10-01", to: "2026-10-02", requests: 0, days: [] });
		expect(res.body.units).toMatchObject({ outputGb: 0, lambdaGbSeconds: 0, llmTokens: {} });
	});
});
