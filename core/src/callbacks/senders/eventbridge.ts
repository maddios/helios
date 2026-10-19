import { EventBridgeClient, PutEventsCommand, type PutEventsCommandOutput } from "@aws-sdk/client-eventbridge";
import { eventSourceFor, parseEventBusArn } from "../../destinations";
import { callbacksConfig } from "../config";
import type { AttemptOutcome, Envelope } from "./types";

export const ACCESS_DENIED_MESSAGE = "EventBridge denied access to the bus";
export const BUS_NOT_FOUND_MESSAGE = "EventBridge bus was not found";
export const NOT_ACCEPTED_MESSAGE = "EventBridge could not accept the event";
export const ENTRY_REJECTED_MESSAGE = "EventBridge rejected the event entry";

export async function putEvent(
	eventBusArn: string,
	envelope: Envelope,
	accountId: string,
	now: Date
): Promise<PutEventsCommandOutput> {
	const { region } = parseEventBusArn(eventBusArn);
	const client = new EventBridgeClient({ region, endpoint: callbacksConfig().EVENTBRIDGE_ENDPOINT });
	try {
		return await client.send(
			new PutEventsCommand({
				Entries: [
					{
						EventBusName: eventBusArn,
						Source: eventSourceFor(accountId),
						DetailType: envelope.event,
						Detail: JSON.stringify(envelope),
						Time: now
					}
				]
			})
		);
	} finally {
		client.destroy();
	}
}

export function entryRejected(output: PutEventsCommandOutput): boolean {
	return (output.FailedEntryCount ?? 0) > 0;
}

export function eventBridgeErrorName(err: unknown): string | undefined {
	return err instanceof Error ? err.name : undefined;
}

export function eventBridgeErrorMessage(err: unknown): string {
	switch (eventBridgeErrorName(err)) {
		case "AccessDeniedException":
			return ACCESS_DENIED_MESSAGE;
		case "ResourceNotFoundException":
			return BUS_NOT_FOUND_MESSAGE;
		default:
			return NOT_ACCEPTED_MESSAGE;
	}
}

export async function sendEventBridge(
	eventBusArn: string,
	envelope: Envelope,
	accountId: string,
	now: Date
): Promise<AttemptOutcome> {
	try {
		const output = await putEvent(eventBusArn, envelope, accountId, now);
		return entryRejected(output) ? { status: "FAILED", error: ENTRY_REJECTED_MESSAGE } : { status: "DELIVERED" };
	} catch (err) {
		return { status: "FAILED", error: eventBridgeErrorMessage(err) };
	}
}
