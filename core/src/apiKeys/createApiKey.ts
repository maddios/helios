import { randomUUID } from "node:crypto";
import { apiKeys, type ApiKey } from "../models";
import { generateKey } from "./generateKey";
import { hashKey } from "./hashKey";

export type CreateApiKeyInput =
	{ scope: "account"; accountId: string; name: string } | { scope: "admin"; name: string };

export async function createApiKey(input: CreateApiKeyInput): Promise<{ key: string; record: ApiKey }> {
	const key = generateKey(input.scope);
	const base = {
		_id: randomUUID(),
		scope: input.scope,
		name: input.name,
		hash: hashKey(key),
		prefix: key.slice(0, 12),
		createdAt: new Date()
	};
	const record: ApiKey = input.scope === "account" ? { ...base, accountId: input.accountId } : base;
	await apiKeys().insertOne(record);
	return { key, record };
}
