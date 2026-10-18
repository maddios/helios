import request from "supertest";
import { randomUUID } from "node:crypto";
import { ensureIndexes, genericPreset, type MediaAsset } from "@helios/core";
import { createApp } from "../src/app";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { bearer, seedAccount, seedAsset, seedGenericPreset, seedRequest } from "./helpers/fixtures";
import { mockObjectStore } from "./helpers/apiMocks";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));

const app = createApp();
const profiles = genericPreset.profiles.map(({ version: _version, ...profile }) => profile);
const PRESET = { name: "owned", description: "Owner preset", postProcess: genericPreset.postProcess, profiles };

let ownerKey: string;
let ownerId: string;
let intruderKey: string;
let asset: MediaAsset;

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
	await seedGenericPreset();
	mockObjectStore();
	({ key: ownerKey, accountId: ownerId } = await seedAccount("owner"));
	({ key: intruderKey } = await seedAccount("intruder"));
	asset = await seedAsset(ownerId);
});

function as(key: string) {
	return {
		get: (path: string) => request(app).get(path).set("Authorization", bearer(key)),
		post: (path: string, body: object = {}) => request(app).post(path).set("Authorization", bearer(key)).send(body),
		patch: (path: string, body: object) => request(app).patch(path).set("Authorization", bearer(key)).send(body),
		delete: (path: string) => request(app).delete(path).set("Authorization", bearer(key))
	};
}

describe("another account's resources", () => {
	it("returns 404 for a request's cancel, callbacks and redeliver", async () => {
		const owned = await seedRequest(ownerId, asset._id, { status: "COMPLETE" });
		const intruder = as(intruderKey);

		const cancel = await intruder.delete(`/requests/${owned._id}`);
		const callbacks = await intruder.get(`/requests/${owned._id}/callbacks`);
		const redeliver = await intruder.post(`/requests/${owned._id}/callbacks/redeliver`);

		expect([cancel.status, callbacks.status, redeliver.status]).toEqual([404, 404, 404]);
	});

	it("returns 404 for writes to an asset: re-encode, post-process, active still and purge", async () => {
		const intruder = as(intruderKey);

		const reencode = await intruder.post(`/assets/${asset._id}/re-encode`);
		const postProcess = await intruder.post(`/assets/${asset._id}/post-process`, { postProcess: { transcribe: true } });
		const activeStill = await intruder.patch(`/assets/${asset._id}/active-still`, { index: 0 });
		const purge = await intruder.delete(`/assets/${asset._id}`);

		expect([reencode.status, postProcess.status, activeStill.status, purge.status]).toEqual([404, 404, 404, 404]);
		expect(await as(ownerKey).get(`/assets/${asset._id}`)).toMatchObject({ status: 200 });
	});

	it("returns 404 for reads of an asset: transcripts, scenes and dry-run", async () => {
		const intruder = as(intruderKey);

		const transcripts = await intruder.get(`/assets/${asset._id}/transcripts`);
		const scenes = await intruder.get(`/assets/${asset._id}/scenes`);
		const planned = await intruder.post("/presets/generic/dry-run", { assetId: asset._id });

		expect([transcripts.status, scenes.status, planned.status]).toEqual([404, 404, 404]);
	});

	it("returns 404 for an owner's preset when patched or deleted by another account", async () => {
		await as(ownerKey).post("/presets", PRESET);
		const intruder = as(intruderKey);

		const patched = await intruder.patch("/presets/owned", { expectedVersion: 1, description: "x" });
		const deleted = await intruder.delete("/presets/owned?expectedVersion=1");

		expect([patched.status, deleted.status]).toEqual([404, 404]);
		expect((await as(ownerKey).get("/presets/owned")).body.description).toBe("Owner preset");
	});

	it("returns 404 for a random asset id", async () => {
		const res = await as(ownerKey).get(`/assets/${randomUUID()}`);

		expect(res.status).toBe(404);
	});
});
