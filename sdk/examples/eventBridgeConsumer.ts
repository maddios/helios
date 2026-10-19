import type { EventBridgeEvent } from "aws-lambda";
import { Helios, type WebhookEvent } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

async function onRequestCompleted(event: Extract<WebhookEvent, { event: "request.completed" }>): Promise<void> {
	console.log("ready", event.data.asset.id, event.data.asset.version);
}

export const handler = async (event: EventBridgeEvent<string, unknown>): Promise<void> => {
	const helioEvent = helios.webhooks.eventBridgeDetail(event);
	if (helioEvent.event === "request.completed") {
		await onRequestCompleted(helioEvent);
	}
	if (helioEvent.event === "item.completed" && helioEvent.data.item.kind === "encode") {
		console.log("encoded", helioEvent.data.assetId, helioEvent.data.item.profile);
	}
};
