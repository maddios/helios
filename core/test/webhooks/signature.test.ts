import { WEBHOOK_TOLERANCE_SEC } from "@helios/contracts";
import { signPayload, verifySignature } from "../../src/webhooks";

const secret = "whsec_test";
const body = '{"id":"evt_1"}';
const now = 1_800_000_000;

describe("webhook signatures", () => {
	it("verifies a fresh, untampered payload", () => {
		const header = signPayload(secret, now, body);

		expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
		expect(verifySignature(secret, header, body, now, WEBHOOK_TOLERANCE_SEC)).toBe(true);
	});

	it("rejects a tampered body", () => {
		const header = signPayload(secret, now, body);

		expect(verifySignature(secret, header, '{"id":"evt_2"}', now, WEBHOOK_TOLERANCE_SEC)).toBe(false);
	});

	it("rejects a signature made with another secret", () => {
		const header = signPayload("whsec_other", now, body);

		expect(verifySignature(secret, header, body, now, WEBHOOK_TOLERANCE_SEC)).toBe(false);
	});

	it("rejects a timestamp outside the tolerance in either direction", () => {
		const header = signPayload(secret, now, body);

		expect(verifySignature(secret, header, body, now + WEBHOOK_TOLERANCE_SEC + 1, WEBHOOK_TOLERANCE_SEC)).toBe(false);
		expect(verifySignature(secret, header, body, now - WEBHOOK_TOLERANCE_SEC - 1, WEBHOOK_TOLERANCE_SEC)).toBe(false);
	});

	it("accepts a timestamp exactly at the tolerance", () => {
		const header = signPayload(secret, now, body);

		expect(verifySignature(secret, header, body, now + WEBHOOK_TOLERANCE_SEC, WEBHOOK_TOLERANCE_SEC)).toBe(true);
	});

	it.each([
		["an empty header", ""],
		["a missing version", `t=${now}`],
		["a non-hex signature", `t=${now},v1=zz`],
		["a truncated signature", `t=${now},v1=abcd`],
		["a non-numeric timestamp", `t=abc,v1=${"0".repeat(64)}`],
		["an extra field", `t=${now},v1=${"0".repeat(64)},v2=x`]
	])("rejects %s", (_name, header) => {
		expect(verifySignature(secret, header, body, now, WEBHOOK_TOLERANCE_SEC)).toBe(false);
	});
});
