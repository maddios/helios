import { NotFoundError, type Destination, type UpdateAccountRequest, type UploadPolicy } from "@helios/contracts";
import type { UpdateFilter } from "mongodb";
import { assertDestination } from "../destinations";
import { assertUploadPolicy } from "../policy";
import { accounts, type Account } from "../models";
import { assertSourceBuckets } from "./assertSourceBuckets";
import { getAccount } from "./getAccount";

export type AccountPatch = Omit<UpdateAccountRequest, "destination" | "uploadPolicy"> & {
	destination?: Destination | null;
	uploadPolicy?: UploadPolicy | null;
};

function buildUpdate(patch: AccountPatch, existing: Account): UpdateFilter<Account> {
	const set: Partial<Account> = {};
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.sourceBuckets !== undefined) set.sourceBuckets = patch.sourceBuckets;
	if (patch.destination) set.destination = patch.destination;
	if (patch.features !== undefined) set.features = { ...existing.features, ...patch.features };
	if (patch.uploadPolicy) set.uploadPolicy = patch.uploadPolicy;
	const update: UpdateFilter<Account> = { $set: set };
	const unset: Record<string, ""> = {};
	if (patch.destination === null) unset.destination = "";
	if (patch.uploadPolicy === null) unset.uploadPolicy = "";
	if (Object.keys(unset).length > 0) update.$unset = unset;
	return update;
}

export async function updateAccount(id: string, patch: AccountPatch): Promise<Account> {
	const existing = await getAccount(id);
	if (patch.sourceBuckets !== undefined) {
		assertSourceBuckets(patch.sourceBuckets);
	}
	if (patch.destination) {
		await assertDestination(patch.destination);
	}
	if (patch.uploadPolicy) {
		assertUploadPolicy(patch.uploadPolicy);
	}

	const updated = await accounts().findOneAndUpdate({ _id: id }, buildUpdate(patch, existing), {
		returnDocument: "after"
	});
	if (!updated) {
		throw new NotFoundError("Account not found");
	}
	return updated;
}
