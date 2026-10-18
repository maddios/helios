import type { ResourceUnits, Usage } from "@helios/contracts";
import { withTransaction } from "../db";
import { jobReports, pipelineItems, requests, usageDaily, type PipelineRequest } from "../models";
import { buildJobReport } from "./buildJobReport";
import { sendCallback } from "./callbacks";
import { dailyIncrements, dayKey } from "./dailyRollup";
import { computeResourceUnits } from "./resourceUnits";
import { summarizeUsage } from "./usageSummary";

export async function finalizeRequest(request: PipelineRequest, now: Date): Promise<void> {
	const items = await pipelineItems().find({ requestId: request._id }).toArray();
	const status = items.some((item) => item.status === "ERROR") ? "ERROR" : "COMPLETE";
	const usages: Usage[] = items.flatMap((item) => item.usage);
	const usage = summarizeUsage(usages);
	const units = computeResourceUnits(usages);
	await jobReports().updateOne(
		{ _id: request._id },
		{
			$set: buildJobReport(status, items, usage, units),
			$setOnInsert: { requestId: request._id, accountId: request.accountId, assetId: request.assetId, createdAt: now }
		},
		{ upsert: true }
	);
	await recordDailyUnits(request, now, units);
	await sendCallback({ type: "request", requestId: request._id }, `${request._id}:final`);
	await requests().updateOne({ _id: request._id, status: "IN_PROGRESS" }, { $set: { status, completedAt: now } });
}

async function recordDailyUnits(request: PipelineRequest, now: Date, units: ResourceUnits): Promise<void> {
	await withTransaction(async (session) => {
		const first = await jobReports().findOneAndUpdate(
			{ _id: request._id, unitsRecordedAt: { $exists: false } },
			{ $set: { unitsRecordedAt: now } },
			{ returnDocument: "before", session }
		);
		if (first === null) {
			return;
		}
		await usageDaily().updateOne(
			{ _id: dayKey(request.accountId, now) },
			{
				$inc: { requests: 1, ...dailyIncrements(units) },
				$setOnInsert: { accountId: request.accountId, date: now.toISOString().slice(0, 10) }
			},
			{ upsert: true, session }
		);
	});
}
