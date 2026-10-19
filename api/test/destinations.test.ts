import request from "supertest";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { mockClient } from "aws-sdk-client-mock";
import { ensureIndexes, getAccount, updateAccount } from "@helios/core";
import { createApp } from "../src/app";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { bearer, seedAccount, seedAdminKey, seedGenericPreset } from "./helpers/fixtures";
import { mockObjectStore } from "./helpers/apiMocks";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));

const app = createApp();
const eventBridgeMock = mockClient(EventBridgeClient);
const EVENT_BUS = "arn:aws:events:us-east-2:222222222222:event-bus/customer";
const OTHER_BUS = "arn:aws:events:eu-west-1:222222222222:event-bus/other";
const PUBLIC_WEBHOOK = "https://93.184.216.34/hook";
const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";
const DESTINATION_CONFLICT = "Provide either destination or callbackUrl, not both";
const S3_SOURCE = { source: { bucket: "bucket-a", key: "clips/a.mp4" }, preset: "generic" };

let key: string;
let adminKey: string;
let accountId: string;

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
	await seedGenericPreset();
	mockObjectStore();
	eventBridgeMock.reset();
	eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: "e-1" }] });
	({ key, accountId } = await seedAccount());
	adminKey = await seedAdminKey();
});

function as(token: string) {
	return {
		get: (path: string) => request(app).get(path).set("Authorization", bearer(token)),
		post: (path: string, body: object = {}) => request(app).post(path).set("Authorization", bearer(token)).send(body),
		patch: (path: string, body: object) => request(app).patch(path).set("Authorization", bearer(token)).send(body),
		put: (path: string, body: object) => request(app).put(path).set("Authorization", bearer(token)).send(body)
	};
}

const account = () => as(key);
const admin = () => as(adminKey);

const putEventBusNames = () =>
	eventBridgeMock.commandCalls(PutEventsCommand).map((call) => call.args[0].input.Entries?.[0]?.EventBusName);

describe("POST /destinations/test", () => {
	it("tests the account destination when the body is omitted", async () => {
		await updateAccount(accountId, { destination: { type: "eventbridge", eventBusArn: EVENT_BUS } });

		const res = await account().post("/destinations/test");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true });
		expect(putEventBusNames()).toEqual([EVENT_BUS]);
	});

	it("tests a supplied destination instead of the account default", async () => {
		await updateAccount(accountId, { destination: { type: "eventbridge", eventBusArn: EVENT_BUS } });

		const res = await account().post("/destinations/test", {
			destination: { type: "eventbridge", eventBusArn: OTHER_BUS }
		});

		expect(res.status).toBe(200);
		expect(putEventBusNames()).toEqual([OTHER_BUS]);
	});

	it("returns 400 when there is no destination to test", async () => {
		const res = await account().post("/destinations/test");

		expect(res.status).toBe(400);
		expect(res.body.error.message).toBe(
			"No destination to test: set one on the account or supply destination in the body"
		);
		expect(eventBridgeMock.calls()).toHaveLength(0);
	});

	it("explains an EventBridge AccessDenied with the policy hint, returning 200 with ok false", async () => {
		await updateAccount(accountId, { destination: { type: "eventbridge", eventBusArn: EVENT_BUS } });
		const denied = Object.assign(new Error("User is not authorized to perform events:PutEvents"), {
			name: "AccessDeniedException"
		});
		eventBridgeMock.on(PutEventsCommand).rejects(denied);

		const res = await account().post("/destinations/test");

		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(false);
		expect(res.body.error).toEqual({
			code: "eventbridge_access_denied",
			message: "EventBridge denied access to the bus",
			hint: "the bus resource policy doesn't allow Helios to PutEvents; attach the policy from GET /destinations/eventbridge/policy (Helios account 111111111111)"
		});
	});

	it("returns 400 for a bus in Helios's own account", async () => {
		const res = await account().post("/destinations/test", {
			destination: { type: "eventbridge", eventBusArn: "arn:aws:events:eu-west-1:111111111111:event-bus/own" }
		});

		expect(res.status).toBe(400);
		expect(eventBridgeMock.calls()).toHaveLength(0);
	});

	it("returns 429 with Retry-After for a second test inside the cooldown", async () => {
		await updateAccount(accountId, { destination: { type: "eventbridge", eventBusArn: EVENT_BUS } });
		await account().post("/destinations/test");

		const res = await account().post("/destinations/test");

		expect(res.status).toBe(429);
		expect(res.body.error.code).toBe("destination_test_cooldown");
		expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
	});

	it("returns 400 for a malformed bus ARN in the body", async () => {
		const res = await account().post("/destinations/test", {
			destination: { type: "eventbridge", eventBusArn: "arn:aws:sqs:eu-west-1:111111111111:queue" }
		});

		expect(res.status).toBe(400);
	});
});

describe("POST /admin/accounts/{id}/destinations/test", () => {
	it("tests the given account's destination", async () => {
		await updateAccount(accountId, { destination: { type: "eventbridge", eventBusArn: EVENT_BUS } });

		const res = await admin().post(`/admin/accounts/${accountId}/destinations/test`);

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true });
		expect(putEventBusNames()).toEqual([EVENT_BUS]);
	});

	it("returns 404 for an unknown account", async () => {
		const res = await admin().post(`/admin/accounts/${UNKNOWN_ID}/destinations/test`, {
			destination: { type: "eventbridge", eventBusArn: EVENT_BUS }
		});

		expect(res.status).toBe(404);
		expect(eventBridgeMock.calls()).toHaveLength(0);
	});
});

describe("GET /destinations/eventbridge/policy", () => {
	it("returns the resource policy and CLI command for the bus", async () => {
		const res = await account().get(`/destinations/eventbridge/policy`).query({ eventBusArn: EVENT_BUS });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			policy: {
				Version: "2012-10-17",
				Statement: [
					{
						Sid: `helios-${accountId}`,
						Effect: "Allow",
						Principal: { AWS: "arn:aws:iam::111111111111:root" },
						Action: "events:PutEvents",
						Resource: EVENT_BUS,
						Condition: { StringEquals: { "events:source": `helios.${accountId}` } }
					}
				]
			},
			command: "aws events put-permission --region us-east-2 --event-bus-name customer --policy file://policy.json"
		});
	});

	it("returns 400 for a malformed bus ARN", async () => {
		const res = await account().get("/destinations/eventbridge/policy").query({ eventBusArn: "not-an-arn" });

		expect(res.status).toBe(400);
	});
});

describe("GET and PUT /account/destination", () => {
	it("sets the account destination and reads it back", async () => {
		const set = await account().put("/account/destination", {
			destination: { type: "eventbridge", eventBusArn: EVENT_BUS }
		});
		const read = await account().get("/account/destination");

		expect(set.status).toBe(200);
		expect(read.body).toEqual({ destination: { type: "eventbridge", eventBusArn: EVENT_BUS } });
	});

	it("clears the destination with null", async () => {
		await account().put("/account/destination", { destination: { type: "eventbridge", eventBusArn: EVENT_BUS } });

		const cleared = await account().put("/account/destination", { destination: null });

		expect(cleared.body).toEqual({ destination: null });
		expect((await getAccount(accountId)).destination).toBeUndefined();
	});

	it("rejects a bus in Helios's own account with 400", async () => {
		const res = await account().put("/account/destination", {
			destination: { type: "eventbridge", eventBusArn: "arn:aws:events:eu-west-1:111111111111:event-bus/own" }
		});

		expect(res.status).toBe(400);
	});
});

describe("account destination view", () => {
	it("exposes the destination and clears it with null, without the webhook secret", async () => {
		const set = await admin().patch(`/admin/accounts/${accountId}`, {
			destination: { type: "eventbridge", eventBusArn: EVENT_BUS }
		});
		const listed = await admin().get("/admin/accounts");

		expect(set.body.destination).toEqual({ type: "eventbridge", eventBusArn: EVENT_BUS });
		expect(set.body).not.toHaveProperty("callbackUrl");
		expect(JSON.stringify(listed.body)).not.toMatch(/webhookSecret|whsec_/);

		const cleared = await admin().patch(`/admin/accounts/${accountId}`, { destination: null });

		expect(cleared.status).toBe(200);
		expect(cleared.body).not.toHaveProperty("destination");
		expect((await getAccount(accountId)).destination).toBeUndefined();
	});

	it("derives callbackUrl from a webhook destination", async () => {
		const res = await admin().patch(`/admin/accounts/${accountId}`, { callbackUrl: PUBLIC_WEBHOOK });

		expect(res.body.destination).toEqual({ type: "webhook", url: PUBLIC_WEBHOOK });
		expect(res.body.callbackUrl).toBe(PUBLIC_WEBHOOK);
	});
});

describe("destination and callbackUrl together", () => {
	const both = { destination: { type: "eventbridge", eventBusArn: EVENT_BUS }, callbackUrl: PUBLIC_WEBHOOK };

	it("rejects encode with 400", async () => {
		const res = await account().post("/encode", { ...S3_SOURCE, ...both });

		expect(res.status).toBe(400);
		expect(JSON.stringify(res.body.error.details)).toContain(DESTINATION_CONFLICT);
	});

	it("rejects re-encode with 400", async () => {
		const res = await account().post(`/assets/${UNKNOWN_ID}/re-encode`, both);

		expect(res.status).toBe(400);
		expect(JSON.stringify(res.body.error.details)).toContain(DESTINATION_CONFLICT);
	});

	it("rejects post-process with 400", async () => {
		const res = await account().post(`/assets/${UNKNOWN_ID}/post-process`, both);

		expect(res.status).toBe(400);
		expect(JSON.stringify(res.body.error.details)).toContain(DESTINATION_CONFLICT);
	});

	it("rejects multipart complete encode options with 400", async () => {
		const res = await account().post("/uploads/multipart/upload-1/complete", {
			uploadKey: "uploads/a.mp4",
			parts: [{ partNumber: 1, etag: "etag-1" }],
			encode: { preset: "generic", ...both }
		});

		expect(res.status).toBe(400);
		expect(JSON.stringify(res.body.error.details)).toContain(DESTINATION_CONFLICT);
	});

	it("rejects account create with 400", async () => {
		const res = await admin().post("/admin/accounts", {
			slug: "globex",
			name: "Globex",
			sourceBuckets: ["bucket-a"],
			...both
		});

		expect(res.status).toBe(400);
		expect(JSON.stringify(res.body.error.details)).toContain(DESTINATION_CONFLICT);
	});

	it("rejects account patch with 400", async () => {
		const res = await admin().patch(`/admin/accounts/${accountId}`, both);

		expect(res.status).toBe(400);
		expect(JSON.stringify(res.body.error.details)).toContain(DESTINATION_CONFLICT);
	});
});
