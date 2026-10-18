import { randomUUID } from "node:crypto";
import { ConflictError, type CreateAccountRequest } from "@helios/contracts";
import { isDuplicateKeyError } from "../db";
import { accounts, type Account } from "../models";
import { assertPublicUrl } from "../ssrf";
import { assertSourceBuckets } from "./assertSourceBuckets";
import { generateWebhookSecret } from "./generateWebhookSecret";

export async function createAccount(input: CreateAccountRequest): Promise<Account> {
	assertSourceBuckets(input.sourceBuckets);
	if (input.callbackUrl) {
		await assertPublicUrl(input.callbackUrl);
	}

	const account: Account = {
		...input,
		_id: randomUUID(),
		webhookSecret: generateWebhookSecret(),
		features: { peopleAttributes: false, ...input.features },
		createdAt: new Date()
	};

	try {
		await accounts().insertOne(account);
	} catch (err) {
		if (isDuplicateKeyError(err)) {
			throw new ConflictError("Account slug already exists");
		}
		throw err;
	}
	return account;
}
