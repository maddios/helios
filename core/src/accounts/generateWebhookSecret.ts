import { randomBase62 } from "../apiKeys";

export function generateWebhookSecret(): string {
	return `whsec_${randomBase62(32)}`;
}
