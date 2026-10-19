import { createHmac } from "node:crypto";
import { signPayload } from "../../core/src/webhooks/index.js";
import { ConfigurationError, WebhookError, Webhooks, type WebhookEvent } from "../src/index.js";
import { Helios } from "../src/client.js";

const SECRET = "whsec_test_secret";

const TEST_EVENT = {
	id: "evt-1",
	event: "helios.test",
	createdAt: "2026-10-19T00:00:00.000Z",
	sequence: 0,
	data: { accountId: "acc-1" }
};

const REQUEST_COMPLETED = {
	id: "evt-2",
	event: "request.completed",
	createdAt: "2026-10-19T00:00:01.000Z",
	sequence: 3,
	data: {
		request: {
			id: "r1",
			assetId: "a1",
			mode: "encode",
			status: "COMPLETE",
			assetVersion: 1,
			items: [],
			progress: { total: 0, finished: 0, pending: 0 },
			createdAt: "2026-10-19T00:00:00.000Z"
		},
		asset: {
			id: "a1",
			source: { type: "s3", bucket: "bella-sources", key: "clip.mp4" },
			version: 1,
			outputs: {},
			postProcess: {},
			createdAt: "2026-10-19T00:00:00.000Z",
			updatedAt: "2026-10-19T00:00:00.000Z"
		}
	}
};

function signed(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
	const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
	return `t=${timestamp},v1=${digest}`;
}

const webhooks = new Webhooks(SECRET);

function failureCode(action: () => unknown): string {
	try {
		action();
	} catch (err) {
		expect(err).toBeInstanceOf(WebhookError);
		return (err as WebhookError).code;
	}
	throw new Error("expected a WebhookError");
}

describe("webhooks.verify", () => {
	it("returns the typed event for a valid signature", () => {
		const body = JSON.stringify(TEST_EVENT);

		const event = webhooks.verify(body, signed(body));

		expect(event).toEqual(TEST_EVENT);
	});

	it("accepts the raw body as bytes and matches the core signer", () => {
		const body = JSON.stringify(REQUEST_COMPLETED);
		const coreHeader = signPayload(SECRET, Math.floor(Date.now() / 1000), body);

		const event = webhooks.verify(Buffer.from(body), coreHeader);

		expect(event.event).toBe("request.completed");
	});

	it("narrows the union by event name", () => {
		const body = JSON.stringify(REQUEST_COMPLETED);
		const event: WebhookEvent = webhooks.verify(body, signed(body));

		if (event.event === "request.completed") {
			expect(event.data.request.status).toBe("COMPLETE");
			expect(event.data.asset.id).toBe("a1");
		} else {
			throw new Error("narrowing failed");
		}
	});

	it("rejects a tampered body", () => {
		const body = JSON.stringify(TEST_EVENT);
		const header = signed(body);

		expect(failureCode(() => webhooks.verify(body.replace("acc-1", "acc-2"), header))).toBe("signature_mismatch");
	});

	it("rejects a signature made with another secret", () => {
		const body = JSON.stringify(TEST_EVENT);

		expect(failureCode(() => webhooks.verify(body, signed(body, "other")))).toBe("signature_mismatch");
	});

	it("rejects a timestamp outside the tolerance, in either direction", () => {
		const body = JSON.stringify(TEST_EVENT);
		const now = Math.floor(Date.now() / 1000);

		expect(failureCode(() => webhooks.verify(body, signed(body, SECRET, now - 301)))).toBe("timestamp_expired");
		expect(failureCode(() => webhooks.verify(body, signed(body, SECRET, now + 301)))).toBe("timestamp_expired");
	});

	it("honours a custom tolerance", () => {
		const body = JSON.stringify(TEST_EVENT);
		const header = signed(body, SECRET, Math.floor(Date.now() / 1000) - 120);

		expect(failureCode(() => webhooks.verify(body, header, { toleranceSec: 60 }))).toBe("timestamp_expired");
		expect(webhooks.verify(body, header, { toleranceSec: 600 })).toEqual(TEST_EVENT);
	});

	it.each([
		["missing header", undefined],
		["empty header", ""],
		["wrong scheme", "v1=abc"],
		["non-hex digest", `t=${Math.floor(Date.now() / 1000)},v1=zz`]
	])("rejects a malformed header (%s)", (_name, header) => {
		expect(failureCode(() => webhooks.verify(JSON.stringify(TEST_EVENT), header))).toBe("signature_malformed");
	});

	it("reports a signed body that is not JSON as payload_invalid", () => {
		const body = "not json";

		expect(failureCode(() => webhooks.verify(body, signed(body)))).toBe("payload_invalid");
	});

	it("reports a signed body that is not a Helios event as payload_invalid", () => {
		const body = JSON.stringify({ id: "x", event: "request.completed" });

		expect(failureCode(() => webhooks.verify(body, signed(body)))).toBe("payload_invalid");
	});

	it("uses the per-call secret over the client secret", () => {
		const body = JSON.stringify(TEST_EVENT);

		expect(webhooks.verify(body, signed(body, "other"), { secret: "other" })).toEqual(TEST_EVENT);
	});

	it("throws ConfigurationError when no secret is configured", () => {
		const body = JSON.stringify(TEST_EVENT);

		expect(() => new Webhooks(undefined).verify(body, signed(body))).toThrow(ConfigurationError);
	});

	it("is available on the client with the configured secret", () => {
		const helios = new Helios({ apiKey: "k", baseUrl: "https://api.test", webhookSecret: SECRET });
		const body = JSON.stringify(TEST_EVENT);

		expect(helios.webhooks.verify(body, signed(body))).toEqual(TEST_EVENT);
	});
});

describe("webhooks.eventBridgeDetail", () => {
	it("parses the detail of an EventBridge event into the typed event", () => {
		expect(webhooks.eventBridgeDetail({ detail: REQUEST_COMPLETED })).toEqual(REQUEST_COMPLETED);
	});

	it("rejects a detail that is not a Helios event", () => {
		expect(failureCode(() => webhooks.eventBridgeDetail({ detail: { event: "nope" } }))).toBe("payload_invalid");
	});
});
