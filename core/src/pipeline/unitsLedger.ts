import type { ClientSession } from "mongodb";
import type { RequestError, ResourceUnits, RequestStatus, UsageSummary } from "@helios/contracts";
import { withTransaction } from "../db";
import {
	jobReports,
	pipelineItems,
	usageDaily,
	type JobReport,
	type PipelineItem,
	type PipelineRequest
} from "../models";
import { dailyIncrements, dayKey } from "./dailyRollup";
import { computeResourceUnits } from "./resourceUnits";
import { isTerminal } from "./types";

export interface ReportInput {
	status: RequestStatus;
	error?: RequestError;
	items: JobReport["items"];
	usage: UsageSummary;
	resourceUnits: ResourceUnits;
	unitsRecordedItems: string[];
}

export async function storeReportOnce(request: PipelineRequest, now: Date, report: ReportInput): Promise<void> {
	await withTransaction(async (session) => {
		const existing = await jobReports().findOneAndUpdate(
			{ _id: request._id },
			{
				$setOnInsert: {
					requestId: request._id,
					accountId: request.accountId,
					assetId: request.assetId,
					createdAt: now,
					completedAt: now,
					...report
				}
			},
			{ upsert: true, returnDocument: "before", session }
		);
		if (existing === null) {
			await incrementDaily(session, request.accountId, now, report.resourceUnits, true);
		}
	});
}

export async function recordItemUnits(item: PipelineItem): Promise<void> {
	if (!isTerminal(item.status)) {
		return;
	}
	const units = computeResourceUnits(item.usage);
	await withTransaction(async (session) => {
		const report = await jobReports().findOneAndUpdate(
			{ _id: item.requestId, unitsRecordedItems: { $ne: item._id } },
			{ $addToSet: { unitsRecordedItems: item._id }, $inc: dailyIncrements(units, "resourceUnits") },
			{ returnDocument: "after", session }
		);
		if (report !== null) {
			await incrementDaily(session, report.accountId, report.createdAt, units, false);
		}
	});
}

export function settledUnits(items: PipelineItem[]): { resourceUnits: ResourceUnits; unitsRecordedItems: string[] } {
	const settled = items.filter((item) => isTerminal(item.status));
	return {
		resourceUnits: computeResourceUnits(settled.flatMap((item) => item.usage)),
		unitsRecordedItems: settled.map((item) => item._id)
	};
}

async function incrementDaily(
	session: ClientSession,
	accountId: string,
	when: Date,
	units: ResourceUnits,
	countRequest: boolean
): Promise<void> {
	const hasLlmTokens = Object.keys(units.llmTokens).length > 0;
	await usageDaily().updateOne(
		{ _id: dayKey(accountId, when) },
		{
			$inc: { ...(countRequest && { requests: 1 }), ...dailyIncrements(units) },
			$setOnInsert: {
				accountId,
				date: when.toISOString().slice(0, 10),
				...(!hasLlmTokens && { "units.llmTokens": {} })
			}
		},
		{ upsert: true, session }
	);
}

export async function loadItems(requestId: string): Promise<PipelineItem[]> {
	return pipelineItems().find({ requestId }).toArray();
}
