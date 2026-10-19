import type { Destination } from "@helios/contracts";
import { config } from "../config";
import { assertPublicUrl, UnsafeUrlError } from "../ssrf";
import { parseEventBusArn } from "./eventBusArn";

export function assertWebhookScheme(url: string): void {
	if (config().STAGE !== "local" && new URL(url).protocol !== "https:") {
		throw new UnsafeUrlError("Webhook URL must use https");
	}
}

export async function assertDestination(destination: Destination): Promise<void> {
	if (destination.type === "webhook") {
		assertWebhookScheme(destination.url);
		await assertPublicUrl(destination.url);
		return;
	}
	parseEventBusArn(destination.eventBusArn);
}
