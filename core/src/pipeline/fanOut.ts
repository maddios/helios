import { randomUUID } from "crypto";
import { MongoBulkWriteError, MongoServerError } from "mongodb";
import type { Preset, PostProcessRequest, RequestMode, ResolvedPostProcess } from "@helios/contracts";
import { config } from "../config";
import { toMessageAttributes } from "../logger";
import {
	mediaAssets,
	pipelineItems,
	requests,
	type MediaAsset,
	type PipelineItem,
	type PipelineRequest
} from "../models";
import { queueFor } from "../queue";
import { planItems } from "./planItems";
import { resolvePostProcess } from "./resolvePostProcess";
import type { ItemMessage, PlannedItem } from "./types";

const DUPLICATE_KEY_CODE = 11000;

export class RequestIdConflictError extends Error {
	constructor(requestId: string) {
		super(`Request ${requestId} already exists for a different asset or mode`);
		this.name = "RequestIdConflictError";
	}
}

export class NothingToDoError extends Error {
	constructor() {
		super("Request has no work to do");
		this.name = "NothingToDoError";
	}
}

export interface FanOutInput {
	requestId?: string;
	asset: MediaAsset;
	mode: RequestMode;
	preset: Preset;
	postProcess?: PostProcessRequest;
	callbackUrl?: string;
}

export interface FanOutResult {
	request: PipelineRequest;
	created: boolean;
}

export async function fanOut(input: FanOutInput): Promise<FanOutResult> {
	const now = new Date();
	const _id = randomUUID();
	const clientRequestId = input.requestId ?? _id;
	const existing = await requests().findOne({ accountId: input.asset.accountId, clientRequestId });
	if (existing !== null) {
		return continueRequest(existing, input, now);
	}
	const postProcess = resolvePostProcess(input.postProcess, input.preset.postProcess);
	const plan = planRequest({ mode: input.mode, presetSnapshot: input.preset, postProcess }, input.asset);
	if (plan.every((item) => item.status === "SKIPPED")) {
		throw new NothingToDoError();
	}
	const request = buildRequestDoc(_id, input, clientRequestId, postProcess, plan, now);
	const inserted = await insertRequestIfAbsent(request);
	if (inserted !== null) {
		return continueRequest(inserted, input, now);
	}
	return { request: await launch(request, plan, now), created: true };
}

async function continueRequest(existing: PipelineRequest, input: FanOutInput, now: Date): Promise<FanOutResult> {
	if (existing.assetId !== input.asset._id || existing.mode !== input.mode) {
		throw new RequestIdConflictError(existing.clientRequestId);
	}
	if (existing.enqueuedAt !== undefined || existing.status === "CANCELLED") {
		return { request: existing, created: false };
	}
	return { request: await launch(existing, planRequest(existing, input.asset), now), created: false };
}

function planRequest(
	request: Pick<PipelineRequest, "mode" | "presetSnapshot" | "postProcess">,
	asset: MediaAsset
): PlannedItem[] {
	const { LAMBDA_MAX_DURATION_SEC, LAMBDA_MAX_SOURCE_BYTES } = config();
	return planItems({
		preset: request.presetSnapshot,
		source: asset.sourceMetadata,
		postProcess: request.postProcess,
		mode: request.mode,
		thresholds: { maxDurationSec: LAMBDA_MAX_DURATION_SEC, maxSourceBytes: LAMBDA_MAX_SOURCE_BYTES }
	});
}

function buildRequestDoc(
	_id: string,
	input: FanOutInput,
	clientRequestId: string,
	postProcess: ResolvedPostProcess,
	plan: PlannedItem[],
	now: Date
): PipelineRequest {
	return {
		_id,
		clientRequestId,
		accountId: input.asset.accountId,
		assetId: input.asset._id,
		mode: input.mode,
		presetSnapshot: input.preset,
		postProcess,
		assetVersion: input.mode === "reencode" ? input.asset.version + 1 : input.asset.version,
		pendingItems: plan.filter((item) => item.status !== "SKIPPED").map((item) => itemId(_id, item.key)),
		status: "IN_PROGRESS",
		...(input.callbackUrl !== undefined && { callbackUrl: input.callbackUrl }),
		createdAt: now
	};
}

async function insertRequestIfAbsent(doc: PipelineRequest): Promise<PipelineRequest | null> {
	const filter = { accountId: doc.accountId, clientRequestId: doc.clientRequestId };
	try {
		return await requests().findOneAndUpdate(filter, { $setOnInsert: doc }, { upsert: true, returnDocument: "before" });
	} catch (err) {
		if (!isDuplicateKeyError(err)) {
			throw err;
		}
		const found = await requests().findOne(filter);
		if (found === null) {
			throw err;
		}
		return found;
	}
}

async function launch(request: PipelineRequest, plan: PlannedItem[], now: Date): Promise<PipelineRequest> {
	await insertItems(buildItemDocs(request, plan, now));
	if (request.mode !== "postProcess") {
		await updateAsset(request, now);
	}
	const queued = await pipelineItems().find({ requestId: request._id, status: "QUEUED" }).toArray();
	await enqueueItems(request, queued);
	return markEnqueued(request._id, now);
}

function buildItemDocs(request: PipelineRequest, plan: PlannedItem[], now: Date): PipelineItem[] {
	return plan.map((item) => ({
		_id: itemId(request._id, item.key),
		requestId: request._id,
		assetId: request.assetId,
		accountId: request.accountId,
		kind: item.kind,
		...(item.profile !== undefined && { profile: item.profile }),
		queue: item.queue,
		priority: item.priority,
		status: item.status,
		pendingDeps: item.dependsOn.map((key) => itemId(request._id, key)),
		dependents: plan
			.filter((other) => other.dependsOn.includes(item.key))
			.map((other) => itemId(request._id, other.key)),
		attempts: 0,
		progress: 0,
		...(item.status === "SKIPPED" && { completedAt: now }),
		createdAt: now
	}));
}

function itemId(requestId: string, key: string): string {
	return `${requestId}:${key}`;
}

async function insertItems(docs: PipelineItem[]): Promise<void> {
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

async function updateAsset(request: PipelineRequest, now: Date): Promise<void> {
	const result = await mediaAssets().updateOne(
		{ _id: request.assetId, accountId: request.accountId },
		{
			$max: { version: request.assetVersion },
			$set: {
				presetName: request.presetSnapshot.name,
				presetVersion: request.presetSnapshot.version,
				presetSnapshot: request.presetSnapshot,
				updatedAt: now
			}
		}
	);
	if (result.matchedCount === 0) {
		throw new Error(`Asset ${request.assetId} not found for account ${request.accountId}`);
	}
}

async function enqueueItems(request: PipelineRequest, items: PipelineItem[]): Promise<void> {
	const fairQueues = config().SQS_FAIR_QUEUES;
	const queueNames = [...new Set(items.map((item) => item.queue))];
	await Promise.all(
		queueNames.map((name) =>
			queueFor<ItemMessage>(name).sendBatch(
				items
					.filter((item) => item.queue === name)
					.map((item) => ({
						body: { itemId: item._id },
						...(fairQueues && { groupId: request.accountId }),
						attributes: toMessageAttributes({
							accountId: request.accountId,
							requestId: request._id,
							itemId: item._id,
							assetId: request.assetId
						})
					}))
			)
		)
	);
}

async function markEnqueued(_id: string, now: Date): Promise<PipelineRequest> {
	const request = await requests().findOneAndUpdate(
		{ _id },
		{ $set: { enqueuedAt: now } },
		{ returnDocument: "after" }
	);
	if (request === null) {
		throw new Error(`Request ${_id} not found`);
	}
	return request;
}

function isDuplicateKeyError(err: unknown): boolean {
	return err instanceof MongoServerError && err.code === DUPLICATE_KEY_CODE;
}

function isOnlyDuplicateKeyError(err: unknown): boolean {
	if (!(err instanceof MongoBulkWriteError)) {
		return false;
	}
	const writeErrors = Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors];
	return writeErrors.every((writeError) => writeError.code === DUPLICATE_KEY_CODE);
}
