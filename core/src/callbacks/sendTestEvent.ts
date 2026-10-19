import { randomUUID } from "node:crypto";
import {
	TEST_EVENT_NAME,
	type Destination,
	type DestinationTestError,
	type DestinationTestResult
} from "@helios/contracts";
import { getAccount } from "../accounts";
import { parseEventBusArn } from "../destinations";
import { config } from "../config";
import { UnsafeUrlError } from "../ssrf";
import { callbacksConfig } from "./config";
import {
	ACCESS_DENIED_MESSAGE,
	BUS_NOT_FOUND_MESSAGE,
	ENTRY_REJECTED_MESSAGE,
	entryRejected,
	eventBridgeErrorName,
	NOT_ACCEPTED_MESSAGE,
	putEvent
} from "./senders/eventbridge";
import type { Envelope } from "./senders/types";
import { isSuccessStatus, postWebhook, UNREACHABLE_MESSAGE } from "./senders/webhook";

export async function sendTestEvent(destination: Destination, accountId: string): Promise<DestinationTestResult> {
	const now = new Date();
	const envelope: Envelope = {
		id: randomUUID(),
		event: TEST_EVENT_NAME,
		createdAt: now.toISOString(),
		sequence: 0,
		data: { accountId }
	};
	if (destination.type === "eventbridge") {
		parseEventBusArn(destination.eventBusArn);
		return testEventBridge(destination.eventBusArn, envelope, accountId, now);
	}
	const { webhookSecret } = await getAccount(accountId);
	return testWebhook(destination.url, webhookSecret, envelope, now);
}

async function testWebhook(url: string, secret: string, envelope: Envelope, now: Date): Promise<DestinationTestResult> {
	try {
		const status = await postWebhook(url, envelope, secret, now);
		if (isSuccessStatus(status)) {
			return { ok: true, httpStatus: status };
		}
		return failed(
			{
				code: "webhook_failed",
				message: `Receiver responded with status ${status}`,
				hint: `Your endpoint answered HTTP ${status}; check it accepts POST and returns 2xx.`
			},
			status
		);
	} catch (err) {
		if (err instanceof UnsafeUrlError) {
			return failed({
				code: "webhook_address_blocked",
				message: err.message,
				hint: "use a public https URL on port 443 (or 80 outside production) that does not resolve to a private address"
			});
		}
		return failed({
			code: "webhook_unreachable",
			message: UNREACHABLE_MESSAGE,
			hint: `the receiver could not be reached within ${callbacksConfig().CALLBACK_TIMEOUT_SEC} seconds; check the URL is reachable and responds in time`
		});
	}
}

async function testEventBridge(
	eventBusArn: string,
	envelope: Envelope,
	accountId: string,
	now: Date
): Promise<DestinationTestResult> {
	try {
		if (!entryRejected(await putEvent(eventBusArn, envelope, accountId, now))) {
			return { ok: true };
		}
		return failed({
			code: "eventbridge_entry_failed",
			message: ENTRY_REJECTED_MESSAGE,
			hint: "check that the bus exists and that its policy allows Helios to PutEvents from this source"
		});
	} catch (err) {
		return eventBridgeFailure(err);
	}
}

function eventBridgeFailure(err: unknown): DestinationTestResult {
	switch (eventBridgeErrorName(err)) {
		case "AccessDeniedException":
			return failed({
				code: "eventbridge_access_denied",
				message: ACCESS_DENIED_MESSAGE,
				hint: `the bus resource policy doesn't allow Helios to PutEvents; attach the policy from GET /destinations/eventbridge/policy (Helios account ${config().HELIOS_AWS_ACCOUNT_ID})`
			});
		case "ResourceNotFoundException":
			return failed({
				code: "eventbridge_bus_not_found",
				message: BUS_NOT_FOUND_MESSAGE,
				hint: "check the bus name and the region in the ARN"
			});
		default:
			return failed({
				code: "eventbridge_failed",
				message: NOT_ACCEPTED_MESSAGE,
				hint: "check the bus ARN and its region, then test again"
			});
	}
}

function failed(error: DestinationTestError, httpStatus?: number): DestinationTestResult {
	return { ok: false, ...(httpStatus !== undefined && { httpStatus }), error };
}
