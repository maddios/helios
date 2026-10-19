import type { AccountView } from "@helios/contracts";
import type { Account } from "@helios/core";

export function toAccountView(account: Account): AccountView {
	const { destination } = account;
	return {
		id: account._id,
		slug: account.slug,
		name: account.name,
		sourceBuckets: account.sourceBuckets,
		...(destination !== undefined && { destination }),
		...(destination?.type === "webhook" && { callbackUrl: destination.url }),
		features: account.features,
		createdAt: account.createdAt.toISOString()
	};
}
