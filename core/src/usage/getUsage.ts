import type { UsageResponse } from "@helios/contracts";
import { usageDaily } from "../models";
import { decodeUnits } from "./decodeUnits";
import { addUnits, zeroUnits } from "./sumUnits";

export async function getUsage(accountId: string, from: string, to: string): Promise<UsageResponse> {
	const docs = await usageDaily()
		.find({ accountId, date: { $gte: from, $lte: to } })
		.sort({ date: 1 })
		.toArray();
	const days = docs.map((doc) => ({ date: doc.date, requests: doc.requests, units: decodeUnits(doc.units) }));
	return {
		from,
		to,
		requests: days.reduce((sum, day) => sum + day.requests, 0),
		units: days.reduce((sum, day) => addUnits(sum, day.units), zeroUnits()),
		days
	};
}
