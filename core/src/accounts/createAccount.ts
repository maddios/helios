import { randomUUID } from "node:crypto";
import { ConflictError, type CreateAccountRequest } from "@helios/contracts";
import { isDuplicateKeyError } from "../db";
import { assertDestination } from "../destinations";
import { assertUploadPolicy } from "../policy";
import { accounts, type Account } from "../models";
import { assertSourceBuckets } from "./assertSourceBuckets";
import { generateWebhookSecret } from "./generateWebhookSecret";

export async function createAccount(input: CreateAccountRequest): Promise<Account> {
	assertSourceBuckets(input.sourceBuckets);
	if (input.destination !== undefined) {
		await assertDestination(input.destination);
	}
	if (input.uploadPolicy !== undefined) {
		assertUploadPolicy(input.uploadPolicy);
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
