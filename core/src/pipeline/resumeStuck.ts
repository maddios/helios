import type { Filter } from "mongodb";
import { config } from "../config";
import { contextLogger } from "../logger";
import { requests, type PipelineRequest } from "../models";
import { enqueueAnalyze } from "./enqueueAnalyze";
import { launchRequest } from "./launchRequest";

export const RESUME_BATCH_SIZE = 100;

export async function resumeStuckRequests(now: Date): Promise<void> {
	const cutoff = new Date(now.getTime() - config().FANOUT_RESUME_AFTER_SEC * 1000);
	const analyzing = await requests()
		.find({ status: "ANALYZING", analyze: "async", ...stale(cutoff) }, { projection: { _id: 1 } })
		.sort({ createdAt: 1 })
		.limit(RESUME_BATCH_SIZE)
		.toArray();
	const unlaunched = await requests()
		.find({ status: "IN_PROGRESS", enqueuedAt: { $exists: false }, ...stale(cutoff) }, { projection: { _id: 1 } })
		.sort({ createdAt: 1 })
		.limit(RESUME_BATCH_SIZE)
		.toArray();
	for (const { _id } of analyzing) {
		await resumeOne(_id, now, cutoff, () => enqueueAnalyze(_id));
	}
	for (const { _id } of unlaunched) {
		await resumeOne(_id, now, cutoff, () => launchRequest(_id));
	}
}

function stale(cutoff: Date): Filter<PipelineRequest> {
	return {
		$or: [{ resumedAt: { $exists: false }, createdAt: { $lt: cutoff } }, { resumedAt: { $lt: cutoff } }]
	};
}

async function resumeOne(requestId: string, now: Date, cutoff: Date, resume: () => Promise<unknown>): Promise<void> {
	try {
		const claimed = await requests().updateOne({ _id: requestId, ...stale(cutoff) }, { $set: { resumedAt: now } });
		if (claimed.matchedCount === 1) {
			await resume();
		}
	} catch (err) {
		contextLogger({ requestId }).error({ err }, "Stuck request resume failed; retried on the next run");
	}
}
