import request from "supertest";
import { ensureIndexes, genericPreset } from "@helios/core";
import { seedAsset } from "./helpers/fixtures";
import { createApp } from "../src/app";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { videoSource } from "../../core/test/helpers/pipelineFixtures";
import { bearer, seedAccount, seedGenericPreset } from "./helpers/fixtures";
import { mockObjectStore } from "./helpers/apiMocks";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));

const app = createApp();
const profiles = genericPreset.profiles.map(({ version: _version, ...profile }) => profile);
const CREATE_BODY = {
	name: "mine",
	description: "Account preset",
	postProcess: genericPreset.postProcess,
	profiles
};
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

function api() {
	return {
		get: (path: string) => request(app).get(path).set("Authorization", bearer(key)),
		post: (path: string, body: object) => request(app).post(path).set("Authorization", bearer(key)).send(body),
		patch: (path: string, body: object) => request(app).patch(path).set("Authorization", bearer(key)).send(body),
		delete: (path: string) => request(app).delete(path).set("Authorization", bearer(key))
	};
}

describe("presets", () => {
	it("lists system presets alongside account presets", async () => {
		const res = await api().get("/presets");

		expect(res.status).toBe(200);
		expect(res.body.presets).toEqual([expect.objectContaining({ name: "generic", scope: "system" })]);
	});

	it("creates, gets and rejects a duplicate account preset", async () => {
		const created = await api().post("/presets", CREATE_BODY);
		const fetched = await api().get("/presets/mine");
		const duplicate = await api().post("/presets", CREATE_BODY);

		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({ name: "mine", version: 1, scope: "account" });
		expect(fetched.body.name).toBe("mine");
		expect(duplicate.status).toBe(409);
	});

	it("updates a preset and returns 409 for a stale expectedVersion", async () => {
		await api().post("/presets", CREATE_BODY);

		const stale = await api().patch("/presets/mine", { expectedVersion: 7, description: "x" });
		const updated = await api().patch("/presets/mine", { expectedVersion: 1, description: "Renamed" });

		expect(stale.status).toBe(409);
		expect(stale.body.error.code).toBe("preset_version_conflict");
		expect(updated.status).toBe(200);
		expect(updated.body).toMatchObject({ version: 2, description: "Renamed" });
	});

	it("patches, adds and removes profiles with expectedVersion", async () => {
		await api().post("/presets", CREATE_BODY);
		const extra = { ...profiles.find((profile) => profile.type === "video" && !profile.isDefault), name: "extra" };

		const added = await api().post("/presets/mine/profiles", { expectedVersion: 1, profile: extra });
		const patched = await api().patch("/presets/mine/profiles/extra", { expectedVersion: 2, priority: 99 });
		const stale = await api().delete("/presets/mine/profiles/extra?expectedVersion=2");
		const removed = await api().delete("/presets/mine/profiles/extra?expectedVersion=3");

		expect(added.status).toBe(200);
		expect(added.body.version).toBe(2);
		expect(patched.status).toBe(200);
		expect(patched.body.profiles.find((p: { name: string }) => p.name === "extra")).toMatchObject({
			priority: 99,
			version: 2
		});
		expect(stale.status).toBe(409);
		expect(removed.status).toBe(200);
		expect(removed.body.profiles.map((p: { name: string }) => p.name)).not.toContain("extra");
	});

	it("refuses to remove the default profile with 400", async () => {
		await api().post("/presets", CREATE_BODY);
		const defaultName = profiles.find((profile) => profile.isDefault)?.name ?? "";

		const res = await api().delete(`/presets/mine/profiles/${defaultName}?expectedVersion=1`);

		expect(res.status).toBe(400);
	});

	it("clones a system preset and deletes the clone", async () => {
		const cloned = await api().post("/presets/generic/clone", { name: "generic-copy" });
		const deleted = await api().delete("/presets/generic-copy?expectedVersion=1");

		expect(cloned.status).toBe(201);
		expect(cloned.body).toMatchObject({ name: "generic-copy", scope: "account" });
		expect(deleted.status).toBe(204);
	});

	it("treats system presets as read-only for accounts", async () => {
		const res = await api().patch("/presets/generic", { expectedVersion: 1, description: "nope" });
		const deleted = await api().delete("/presets/generic?expectedVersion=1");

		expect(res.status).toBe(403);
		expect(deleted.status).toBe(403);
	});

	it("plans against a deleted asset with 404", async () => {
		const asset = await seedAsset(accountId, { deletedAt: new Date() });

		const res = await api().post("/presets/generic/dry-run", { assetId: asset._id });

		expect(res.status).toBe(404);
	});

	it("returns 404 for an unknown preset", async () => {
		const res = await api().get("/presets/missing");

		expect(res.status).toBe(404);
	});

	it("plans a preset against source metadata with dry-run", async () => {
		const planned = await api().post("/presets/generic/dry-run", { sourceMetadata: videoSource });
		const invalid = await api().post("/presets/generic/dry-run", {});

		expect(planned.status).toBe(200);
		expect(planned.body.items.length).toBeGreaterThan(0);
		expect(planned.body.items[0]).toMatchObject({ key: expect.any(String), queue: expect.any(String) });
		expect(invalid.status).toBe(400);
	});
});
