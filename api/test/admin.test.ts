import request from "supertest";
import { ensureIndexes, genericPreset } from "@helios/core";
import { createApp } from "../src/app";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { bearer, seedAccount, seedAdminKey, seedGenericPreset } from "./helpers/fixtures";
import { mockObjectStore } from "./helpers/apiMocks";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));

const app = createApp();
const SECRET_PATTERN = /"hash"|webhookSecret|whsec_/;
let adminKey: string;

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
	await seedGenericPreset();
	mockObjectStore();
	adminKey = await seedAdminKey();
});

const admin = () => ({
	get: (path: string) => request(app).get(path).set("Authorization", bearer(adminKey)),
	post: (path: string, body: object) => request(app).post(path).set("Authorization", bearer(adminKey)).send(body),
	patch: (path: string, body: object) => request(app).patch(path).set("Authorization", bearer(adminKey)).send(body),
	delete: (path: string) => request(app).delete(path).set("Authorization", bearer(adminKey))
});

const ACCOUNT_BODY = {
	slug: "globex",
	name: "Globex",
	sourceBuckets: ["bucket-a"],
	features: { peopleAttributes: true }
};

describe("admin accounts", () => {
	it("creates an account and returns its webhook secret once", async () => {
		const res = await admin().post("/admin/accounts", ACCOUNT_BODY);

		expect(res.status).toBe(201);
		expect(res.body.webhookSecret).toMatch(/^whsec_/);
		expect(res.body).toMatchObject({ slug: "globex", features: { peopleAttributes: true } });
		expect(res.body).not.toHaveProperty("hash");
	});

	it("returns 409 for a duplicate slug", async () => {
		await admin().post("/admin/accounts", ACCOUNT_BODY);

		const res = await admin().post("/admin/accounts", ACCOUNT_BODY);

		expect(res.status).toBe(409);
	});

	it("lists and updates accounts without leaking secrets", async () => {
		const created = await admin().post("/admin/accounts", ACCOUNT_BODY);
		const listed = await admin().get("/admin/accounts");
		const updated = await admin().patch(`/admin/accounts/${created.body.id}`, { name: "Globex Corp" });

		expect(listed.body.accounts).toHaveLength(1);
		expect(JSON.stringify(listed.body)).not.toMatch(SECRET_PATTERN);
		expect(updated.status).toBe(200);
		expect(updated.body.name).toBe("Globex Corp");
		expect(JSON.stringify(updated.body)).not.toMatch(SECRET_PATTERN);
	});

	it("issues a key that works, then revokes it", async () => {
		const created = await admin().post("/admin/accounts", ACCOUNT_BODY);

		const issued = await admin().post(`/admin/accounts/${created.body.id}/keys`, { name: "ci" });
		const usable = await request(app)
			.get("/usage?from=2026-10-01&to=2026-10-01")
			.set("Authorization", bearer(issued.body.key));
		const revoked = await admin().delete(`/admin/accounts/${created.body.id}/keys/${issued.body.id}`);
		const rejected = await request(app)
			.get("/usage?from=2026-10-01&to=2026-10-01")
			.set("Authorization", bearer(issued.body.key));

		expect(issued.status).toBe(201);
		expect(issued.body.key).toMatch(/^sk_live_/);
		expect(issued.body).not.toHaveProperty("hash");
		expect(usable.status).toBe(200);
		expect(revoked.status).toBe(204);
		expect(rejected.status).toBe(401);
	});

	it("returns 404 when a key is revoked through another account", async () => {
		const owner = await admin().post("/admin/accounts", ACCOUNT_BODY);
		const other = await admin().post("/admin/accounts", { ...ACCOUNT_BODY, slug: "initech" });
		const issued = await admin().post(`/admin/accounts/${owner.body.id}/keys`, { name: "ci" });

		const res = await admin().delete(`/admin/accounts/${other.body.id}/keys/${issued.body.id}`);
		const usable = await request(app)
			.get("/usage?from=2026-10-01&to=2026-10-01")
			.set("Authorization", bearer(issued.body.key));

		expect(res.status).toBe(404);
		expect(usable.status).toBe(200);
	});

	it("returns 404 when issuing a key for an unknown account", async () => {
		const res = await admin().post("/admin/accounts/00000000-0000-0000-0000-000000000000/keys", { name: "x" });

		expect(res.status).toBe(404);
	});

	it("rotates the webhook secret and returns the new one once", async () => {
		const created = await admin().post("/admin/accounts", ACCOUNT_BODY);

		const rotated = await admin().post(`/admin/accounts/${created.body.id}/webhook-secret/rotate`, {});

		expect(rotated.status).toBe(200);
		expect(rotated.body.webhookSecret).toMatch(/^whsec_/);
		expect(rotated.body.webhookSecret).not.toBe(created.body.webhookSecret);
	});

	it("serves per-account usage totals to admins", async () => {
		await seedAccount("acme");

		const res = await admin().get("/admin/usage?from=2026-10-01&to=2026-10-02");

		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ from: "2026-10-01", to: "2026-10-02", accounts: [] });
	});
});

describe("admin system presets", () => {
	const PRESET = {
		name: "studio",
		description: "System preset",
		postProcess: genericPreset.postProcess,
		profiles: genericPreset.profiles.map(({ version: _version, ...profile }) => profile)
	};

	it("creates, reads, updates and deletes a system preset", async () => {
		const created = await admin().post("/admin/presets", PRESET);
		const fetched = await admin().get("/admin/presets/studio");
		const updated = await admin().patch("/admin/presets/studio", { expectedVersion: 1, description: "Updated" });
		const deleted = await admin().delete("/admin/presets/studio?expectedVersion=2");

		expect(created.status).toBe(201);
		expect(created.body.scope).toBe("system");
		expect(fetched.status).toBe(200);
		expect(updated.body.version).toBe(2);
		expect(deleted.status).toBe(204);
	});
});
