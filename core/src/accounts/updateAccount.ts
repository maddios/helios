import { NotFoundError, type UpdateAccountRequest } from "@helios/contracts";
import type { UpdateFilter } from "mongodb";
import { accounts, type Account } from "../models";
import { assertPublicUrl } from "../ssrf";
import { assertSourceBuckets } from "./assertSourceBuckets";
import { getAccount } from "./getAccount";

function buildUpdate(patch: UpdateAccountRequest, existing: Account): UpdateFilter<Account> {
	const set: Partial<Account> = {};
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.sourceBuckets !== undefined) set.sourceBuckets = patch.sourceBuckets;
	if (typeof patch.callbackUrl === "string") set.callbackUrl = patch.callbackUrl;
	if (patch.features !== undefined) set.features = { ...existing.features, ...patch.features };
	const update: UpdateFilter<Account> = { $set: set };
	if (patch.callbackUrl === null) update.$unset = { callbackUrl: "" };
	return update;
}

export async function updateAccount(id: string, patch: UpdateAccountRequest): Promise<Account> {
	const existing = await getAccount(id);
	if (patch.sourceBuckets !== undefined) {
		assertSourceBuckets(patch.sourceBuckets);
	}
	if (patch.callbackUrl) {
		await assertPublicUrl(patch.callbackUrl);
	}

	const updated = await accounts().findOneAndUpdate({ _id: id }, buildUpdate(patch, existing), {
		returnDocument: "after"
	});
	if (!updated) {
		throw new NotFoundError("Account not found");
	}
	return updated;
}
