import { pipelineItems, type PipelineItem, type PipelineRequest } from "../models";
import { isOnlyDuplicateKeyError } from "../db";
import type { PlannedItem } from "./types";

export function itemId(requestId: string, key: string): string {
	return `${requestId}:${key}`;
}

export function buildItemDocs(request: PipelineRequest, plan: PlannedItem[], now: Date): PipelineItem[] {
	return plan.map((item) => ({
		_id: itemId(request._id, item.key),
		key: item.key,
		requestId: request._id,
		assetId: request.assetId,
		accountId: request.accountId,
		kind: item.kind,
		...(item.profile !== undefined && { profile: item.profile }),
		queue: item.queue,
		priority: item.priority,
		status: item.status,
		pendingDeps: item.dependsOn.map((dep) => itemId(request._id, dep.key)),
		requiredDeps: item.dependsOn.filter((dep) => dep.required).map((dep) => itemId(request._id, dep.key)),
		dependents: plan
			.filter((other) => other.dependsOn.some((dep) => dep.key === item.key))
			.map((other) => itemId(request._id, other.key)),
		usage: [],
		attempts: 0,
		progress: 0,
		...(item.status === "SKIPPED" && { completedAt: now }),
		createdAt: now
	}));
}

export async function insertItems(docs: PipelineItem[]): Promise<void> {
	if (docs.length === 0) {
		return;
	}
	try {
		await pipelineItems().insertMany(docs, { ordered: false });
	} catch (err) {
		if (!isOnlyDuplicateKeyError(err)) {
			throw err;
		}
	}
}
