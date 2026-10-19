import express from "express";
import { Helios, WebhookError, type WebhookEvent } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL"),
	webhookSecret: requireEnv("HELIOS_WEBHOOK_SECRET")
});

const processed = new Set<string>();

const app = express();

app.post("/helios/webhooks", express.raw({ type: "application/json" }), (req, res) => {
	let event: WebhookEvent;
	try {
		event = helios.webhooks.verify(req.body, req.get("Helios-Signature"));
	} catch (err) {
		if (err instanceof WebhookError) {
			res.sendStatus(400);
			return;
		}
		throw err;
	}

	if (!processed.has(event.id)) {
		if (event.event === "request.completed") {
			console.log("ready", event.data.asset.id, event.data.request.status);
		}
		if (event.event === "item.failed") {
			console.error("item failed", event.data.item.key, event.data.item.error);
		}
		processed.add(event.id);
	}

	res.sendStatus(204);
});

app.listen(Number(requireEnv("PORT")));
