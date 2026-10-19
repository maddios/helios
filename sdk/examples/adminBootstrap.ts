import { writeFileSync } from "node:fs";
import { HeliosAdmin } from "@partnrup/helios-sdk/admin";
import { requireEnv } from "./requireEnv.js";

const admin = new HeliosAdmin({
	apiKey: requireEnv("HELIOS_ADMIN_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const account = await admin.accounts.create({
	slug: "bella",
	name: "Bella",
	sourceBuckets: [requireEnv("KODAK_SOURCE_BUCKET")],
	destination: { type: "webhook", url: requireEnv("BELLA_WEBHOOK_URL") }
});
const key = await admin.keys.create(account.id, { name: "bella-backend" });

writeFileSync(
	requireEnv("BOOTSTRAP_OUTPUT"),
	JSON.stringify({ accountId: account.id, apiKey: key.key, webhookSecret: account.webhookSecret }),
	{ mode: 0o600 }
);
