import { WEBHOOK_EVENT_HEADER, WEBHOOK_EVENT_ID_HEADER, WEBHOOK_SIGNATURE_HEADER } from "@helios/contracts";
import { assertWebhookScheme } from "../../destinations";
import { safePost, UnsafeUrlError } from "../../ssrf";
import { signPayload } from "../../webhooks";
import { callbacksConfig } from "../config";
import type { AttemptOutcome, Envelope } from "./types";

const MS_PER_SEC = 1000;
export const UNREACHABLE_MESSAGE = "Receiver could not be reached";

export async function postWebhook(url: string, envelope: Envelope, secret: string, now: Date): Promise<number> {
	assertWebhookScheme(url);
	const body = JSON.stringify(envelope);
	const { status } = await safePost(url, {
		body,
		headers: signedHeaders(envelope, secret, body, now),
		timeoutSec: callbacksConfig().CALLBACK_TIMEOUT_SEC
	});
	return status;
}

export function isSuccessStatus(status: number): boolean {
	return status >= 200 && status <= 299;
}

export async function sendWebhook(url: string, envelope: Envelope, secret: string, now: Date): Promise<AttemptOutcome> {
	try {
		const status = await postWebhook(url, envelope, secret, now);
		return isSuccessStatus(status)
			? { status: "DELIVERED", httpStatus: status }
			: { status: "FAILED", httpStatus: status, error: `Receiver responded with status ${status}` };
	} catch (err) {
		return { status: "FAILED", error: err instanceof UnsafeUrlError ? err.message : UNREACHABLE_MESSAGE };
	}
}

function signedHeaders(envelope: Envelope, secret: string, body: string, now: Date): Record<string, string> {
	return {
		"content-type": "application/json",
		[WEBHOOK_SIGNATURE_HEADER]: signPayload(secret, Math.floor(now.getTime() / MS_PER_SEC), body),
		[WEBHOOK_EVENT_ID_HEADER]: envelope.id,
		[WEBHOOK_EVENT_HEADER]: envelope.event
	};
}
