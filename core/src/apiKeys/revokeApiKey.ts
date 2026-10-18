import { NotFoundError } from "@helios/contracts";
import { apiKeys } from "../models";

export async function revokeApiKey(accountId: string, keyId: string, now = new Date()): Promise<void> {
	const result = await apiKeys().updateOne(
		{ _id: keyId, accountId, revokedAt: { $exists: false } },
		{ $set: { revokedAt: now } }
	);
	if (result.matchedCount === 0) {
		throw new NotFoundError("API key not found");
	}
}
