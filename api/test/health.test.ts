import request from "supertest";
import { MongoNetworkError, ensureIndexes } from "@helios/core";
import * as db from "../../core/src/db";
import { createApp } from "../src/app";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));

const app = createApp();

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
});
afterEach(() => {
	jest.restoreAllMocks();
});

describe("liveness and readiness", () => {
	it("reports liveness without touching the database", async () => {
		const ping = jest.spyOn(db, "pingDatabase").mockRejectedValue(new MongoNetworkError("down"));

		const res = await request(app).get("/health");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ status: "ok" });
		expect(ping).not.toHaveBeenCalled();
	});

	it("reports ready when the database answers a ping", async () => {
		const res = await request(app).get("/ready");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ status: "ready" });
	});

	it("returns 503 with Retry-After when the database is unavailable", async () => {
		jest.spyOn(db, "pingDatabase").mockRejectedValue(new MongoNetworkError("down"));

		const res = await request(app).get("/ready");

		expect(res.status).toBe(503);
		expect(res.headers["retry-after"]).toBe("5");
		expect(res.body.error.code).toBe("service_unavailable");
	});
});
