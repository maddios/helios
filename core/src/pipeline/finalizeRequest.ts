import type { RequestError, RequestStatus } from "@helios/contracts";
import { jobReports, requests, type PipelineRequest } from "../models";
import { sendCallback } from "./callbacks";
import { summarizeUsage } from "./usageSummary";
import { loadItems, recordItemUnits, settledUnits, storeReportOnce } from "./unitsLedger";
import { OPEN_REQUEST_STATUSES } from "./types";
import { toReportItems } from "./reportItems";

export interface RequestOutcome {
	status?: RequestStatus;
	error?: RequestError;
}

export async function finalizeRequest(
	request: PipelineRequest,
	now: Date,
	outcome: RequestOutcome = {}
): Promise<void> {
	const items = await loadItems(request._id);
	const status = outcome.status ?? (items.some((item) => item.status === "ERROR") ? "ERROR" : "COMPLETE");
	await storeReportOnce(request, now, {
		status,
		...(outcome.error !== undefined && { error: outcome.error }),
		items: toReportItems(items),
		usage: summarizeUsage(items.flatMap((item) => item.usage)),
		...settledUnits(items)
	});
	const report = await jobReports().findOne({ _id: request._id });
	if (report === null) {
		throw new Error(`Job report for request ${request._id} is missing after finalize`);
	}
	await recordLateUnits(request._id);
	await sendCallback({ type: "request", requestId: request._id }, `${request._id}:final`);
	await requests().updateOne(
		{ _id: request._id, status: { $in: [...OPEN_REQUEST_STATUSES] } },
		{
			$set: {
				status: report.status,
				completedAt: now,
				...(report.error !== undefined && { error: report.error })
			}
		}
	);
}

async function recordLateUnits(requestId: string): Promise<void> {
	for (const item of await loadItems(requestId)) {
		await recordItemUnits(item);
	}
}
