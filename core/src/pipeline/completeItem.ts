import type { Usage } from "@helios/contracts";
import type { UpdateFilter } from "mongodb";
import {
	mediaAssets,
	pipelineItems,
	requests,
	type ItemOutput,
	type PipelineItem,
	type PipelineRequest
} from "../models";
import { releaseDependent } from "./releaseDependents";
import { sendCallback } from "./callbacks";
import { finalizeRequest } from "./finalizeRequest";
import { isFailed, TERMINAL_STATUSES, type TerminalStatus } from "./types";

export interface CompleteItemInput {
	itemId: string;
	status: TerminalStatus;
	output?: ItemOutput;
	usage?: Usage;
	error?: string;
}

export async function completeItem(input: CompleteItemInput): Promise<void> {
	const now = new Date();
	await pipelineItems().updateOne(
		{ _id: input.itemId, status: { $nin: [...TERMINAL_STATUSES] } },
		settleUpdate(input, now)
	);
	const item = await pipelineItems().findOne({ _id: input.itemId });
	if (item === null) {
		throw new Error(`Item ${input.itemId} not found`);
	}
	const request = await requests().findOne({ _id: item.requestId });
	if (request === null) {
		throw new Error(`Request ${item.requestId} not found for item ${item._id}`);
	}
	await recordAssetOutputs(item, request);
	await handoffDependents(item);
	await sendCallback({ type: "item", requestId: item.requestId, itemId: item._id }, `${item._id}:item`);
	await completeRequestItem(item, now);
}

function settleUpdate(input: CompleteItemInput, now: Date): UpdateFilter<PipelineItem> {
	const { status, output, usage, error } = input;
	return {
		$set: {
			status,
			completedAt: now,
			...(output !== undefined && { output }),
			...(status !== "COMPLETE" && error !== undefined && { error })
		},
		...(status === "COMPLETE" && { $unset: { error: "" } }),
		...(usage !== undefined && { $push: { usage } })
	};
}

async function recordAssetOutputs(item: PipelineItem, request: PipelineRequest): Promise<void> {
	if (item.status !== "COMPLETE" || item.output === undefined) {
		return;
	}
	const set = outputSet(item.output);
	if (Object.keys(set).length === 0) {
		return;
	}
	await mediaAssets().updateOne(
		{ _id: item.assetId, accountId: item.accountId, version: { $lte: request.assetVersion } },
		{ $set: set }
	);
}

function outputSet(output: ItemOutput): Record<string, unknown> {
	return {
		...Object.fromEntries(
			Object.entries(output.assetOutputs ?? {}).map(([name, assetOutput]) => [`outputs.${name}`, assetOutput])
		),
		...(output.activeStill !== undefined && { activeStill: output.activeStill })
	};
}

async function handoffDependents(item: PipelineItem): Promise<void> {
	for (const dependentId of item.dependents) {
		const dependent = await pipelineItems().findOneAndUpdate(
			{ _id: dependentId },
			{ $pull: { pendingDeps: item._id } },
			{ returnDocument: "after" }
		);
		if (dependent === null || dependent.status !== "BLOCKED") {
			continue;
		}
		if (isFailed(item.status) && dependent.requiredDeps.includes(item._id)) {
			await completeItem({ itemId: dependent._id, status: "SKIPPED", error: `dependency ${item._id} ${item.status}` });
		} else {
			await releaseDependent(dependent);
		}
	}
}

async function completeRequestItem(item: PipelineItem, now: Date): Promise<void> {
	const pulled = await requests().findOneAndUpdate(
		{ _id: item.requestId, pendingItems: item._id },
		{ $pull: { pendingItems: item._id } },
		{ returnDocument: "after" }
	);
	const request = pulled ?? (await requests().findOne({ _id: item.requestId }));
	if (request === null) {
		throw new Error(`Request ${item.requestId} not found`);
	}
	if (request.pendingItems.length === 0 && request.status === "IN_PROGRESS") {
		await finalizeRequest(request, now);
	}
}
