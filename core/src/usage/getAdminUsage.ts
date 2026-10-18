import type { AdminUsageAccount, AdminUsageResponse } from "@helios/contracts";
import { usageDaily } from "../models";
import { decodeUnits } from "./decodeUnits";
import { addUnits, zeroUnits } from "./sumUnits";

export async function getAdminUsage(from: string, to: string): Promise<AdminUsageResponse> {
	const docs = await usageDaily()
		.find({ date: { $gte: from, $lte: to } })
		.sort({ accountId: 1, date: 1 })
		.toArray();
	const accounts = new Map<string, AdminUsageAccount>();
	for (const doc of docs) {
		const account = accounts.get(doc.accountId) ?? { accountId: doc.accountId, requests: 0, units: zeroUnits() };
		accounts.set(doc.accountId, {
			accountId: doc.accountId,
			requests: account.requests + doc.requests,
			units: addUnits(account.units, decodeUnits(doc.units))
		});
	}
	return { from, to, accounts: [...accounts.values()] };
}
