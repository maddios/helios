import { createHmac, timingSafeEqual } from "node:crypto";
import { WEBHOOK_TOLERANCE_SEC, WebhookEventSchema } from "@helios/contracts";
import { ConfigurationError, WebhookError } from "./errors.js";
import { integerIn, nonEmptySecret } from "./validation.js";
import type { WebhookEvent } from "./types.js";

const MAX_TOLERANCE_SEC = 86_400;

/** Options of `webhooks.verify`. */
export interface VerifyOptions {
	/** Secret for this call. Defaults to the client's `webhookSecret`. */
	secret?: string;
	/** Maximum age of the signature timestamp, in seconds, in either direction, from 0 to 86400. Defaults to 300. */
	toleranceSec?: number;
}

const SIGNATURE_PATTERN = /^t=(\d+),v1=([0-9a-f]+)$/;

/**
 * Verifies and parses webhook events signed with the account's webhook secret.
 *
 * Verify the raw request body, before any JSON parsing or re-serialisation. The signature covers `"<t>.<rawBody>"`.
 *
 * @example
 * app.post("/hook", express.raw({ type: "application/json" }), (req, res) => {
 *   const event = helios.webhooks.verify(req.body, req.get("Helios-Signature"));
 *   if (event.event === "request.completed") markReady(event.data.asset.id);
 *   res.sendStatus(204);
 * });
 */
export class Webhooks {
	private readonly secret: string | undefined;

	/**
	 * @param secret Default webhook secret, used when `verify` is called without one. Must not be empty.
	 * @throws {ConfigurationError} When the secret is an empty string.
	 * @internal
	 */
	constructor(secret: string | undefined) {
		this.secret = secret === undefined ? undefined : nonEmptySecret(secret);
	}

	/**
	 * Checks the `Helios-Signature` header against the raw body, then parses the body into a typed event.
	 *
	 * The signature is checked with a timing-safe comparison and the timestamp must be within `toleranceSec`. The body is
	 * parsed only after the signature passes.
	 *
	 * @param rawBody The exact request body bytes or string, as received.
	 * @param signatureHeader The `Helios-Signature` header value, `t=<unix>,v1=<lowercase hex>`. Like the server, the
	 * parser accepts no surrounding whitespace and no upper-case hex.
	 * @param options Per-call secret and tolerance.
	 * @returns The typed event, a discriminated union on `event`.
	 * @throws {ConfigurationError} When no secret is configured, or the secret is empty.
	 * @throws {WebhookError} With code `signature_malformed`, `signature_mismatch`, `timestamp_expired` or `payload_invalid`.
	 * @example
	 * const event = helios.webhooks.verify(rawBody, header, { toleranceSec: 60 });
	 */
	verify(rawBody: string | Uint8Array, signatureHeader: string | undefined, options: VerifyOptions = {}): WebhookEvent {
		const secret = options.secret === undefined ? this.secret : nonEmptySecret(options.secret);
		if (secret === undefined) {
			throw new ConfigurationError("configuration_error", "A webhook secret is required to verify webhooks");
		}
		const match = SIGNATURE_PATTERN.exec(signatureHeader ?? "");
		if (match === null) {
			throw new WebhookError("signature_malformed", "The Helios-Signature header is malformed");
		}
		const timestamp = Number(match[1]);
		const toleranceSec = integerIn("toleranceSec", options.toleranceSec ?? WEBHOOK_TOLERANCE_SEC, 0, MAX_TOLERANCE_SEC);
		if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSec) {
			throw new WebhookError("timestamp_expired", "The webhook signature timestamp is outside the tolerance");
		}
		const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody);
		if (!sameDigest(signatureOf(secret, timestamp, body), match[2])) {
			throw new WebhookError("signature_mismatch", "The webhook signature does not match the body");
		}
		return parseEvent(parseBody(body));
	}

	/**
	 * Parses the `detail` of an EventBridge event delivered to a customer bus into a typed event.
	 *
	 * @param event The EventBridge event, as delivered to a rule target. Only `detail` is read.
	 * @returns The typed event, identical to the webhook payload.
	 * @throws {WebhookError} With code `payload_invalid` when `detail` is not a Helios event.
	 * @example
	 * export const handler = async (event: { detail: unknown }) => {
	 *   const detail = helios.webhooks.eventBridgeDetail(event);
	 * };
	 */
	eventBridgeDetail(event: { detail: unknown }): WebhookEvent {
		return parseEvent(event.detail);
	}
}

function signatureOf(secret: string, timestamp: number, body: Buffer): Buffer {
	return createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest();
}

function sameDigest(expected: Buffer, actualHex: string): boolean {
	const actual = Buffer.from(actualHex, "hex");
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseBody(body: Buffer): unknown {
	try {
		return JSON.parse(body.toString("utf8"));
	} catch (err) {
		throw new WebhookError("payload_invalid", "The webhook body is not valid JSON", { cause: err });
	}
}

function parseEvent(value: unknown): WebhookEvent {
	const parsed = WebhookEventSchema.safeParse(value);
	if (!parsed.success) {
		throw new WebhookError("payload_invalid", "The webhook body is not a Helios event", {
			details: parsed.error.issues
		});
	}
	return parsed.data;
}
