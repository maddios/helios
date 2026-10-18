import { NotFoundError } from "@helios/contracts";
import { accounts } from "../models";
import { generateWebhookSecret } from "./generateWebhookSecret";

export async function rotateWebhookSecret(id: string): Promise<string> {
	const webhookSecret = generateWebhookSecret();
	const result = await accounts().updateOne({ _id: id }, { $set: { webhookSecret } });
	if (result.matchedCount === 0) {
		throw new NotFoundError("Account not found");
	}
	return webhookSecret;
}
