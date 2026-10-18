import type { AccountView } from "@helios/contracts";
import type { Account } from "@helios/core";

export function toAccountView(account: Account): AccountView {
	return {
		id: account._id,
		slug: account.slug,
		name: account.name,
		sourceBuckets: account.sourceBuckets,
		...(account.callbackUrl !== undefined && { callbackUrl: account.callbackUrl }),
		features: account.features,
		createdAt: account.createdAt.toISOString()
	};
}
