import { NotFoundError, type Destination, type UpdateAccountRequest } from "@helios/contracts";
import type { UpdateFilter } from "mongodb";
import { assertDestination } from "../destinations";
import { accounts, type Account } from "../models";
import { assertSourceBuckets } from "./assertSourceBuckets";
import { getAccount } from "./getAccount";

export type AccountPatch = Omit<UpdateAccountRequest, "destination"> & { destination?: Destination | null };

function buildUpdate(patch: AccountPatch, existing: Account): UpdateFilter<Account> {
	const set: Partial<Account> = {};
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.sourceBuckets !== undefined) set.sourceBuckets = patch.sourceBuckets;
	if (patch.destination) set.destination = patch.destination;
	if (patch.features !== undefined) set.features = { ...existing.features, ...patch.features };
	const update: UpdateFilter<Account> = { $set: set };
	if (patch.destination === null) update.$unset = { destination: "" };
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

	const updated = await accounts().findOneAndUpdate({ _id: id }, buildUpdate(patch, existing), {
		returnDocument: "after"
	});
	if (!updated) {
		throw new NotFoundError("Account not found");
	}
	return updated;
}
