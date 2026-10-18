import { UnauthorizedError } from "@helios/contracts";
import { apiKeys, type ApiKey } from "../models";
import { hashKey } from "./hashKey";

const LAST_USED_THROTTLE_MS = 60_000;

export async function authenticate(plaintext: string, now = new Date()): Promise<ApiKey> {
	const record = await apiKeys().findOne({ hash: hashKey(plaintext), revokedAt: { $exists: false } });
	if (!record) {
		throw new UnauthorizedError();
	}
	await apiKeys().updateOne(
		{
			_id: record._id,
			$or: [
				{ lastUsedAt: { $exists: false } },
				{ lastUsedAt: { $lt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) } }
			]
		},
		{ $set: { lastUsedAt: now } }
	);
	return record;
}
