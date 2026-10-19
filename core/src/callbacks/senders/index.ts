import type { Destination } from "@helios/contracts";
import type { Account } from "../../models";
import { sendEventBridge } from "./eventbridge";
import { sendWebhook } from "./webhook";
import type { AttemptOutcome, Envelope } from "./types";

export type { AttemptOutcome, Envelope } from "./types";

export function sendTo(
	destination: Destination,
	envelope: Envelope,
	account: Pick<Account, "_id" | "webhookSecret">,
	now: Date
): Promise<AttemptOutcome> {
	switch (destination.type) {
		case "webhook":
			return sendWebhook(destination.url, envelope, account.webhookSecret, now);
		case "eventbridge":
			return sendEventBridge(destination.eventBusArn, envelope, account._id, now);
	}
}
