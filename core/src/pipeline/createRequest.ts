import { randomUUID } from "crypto";
import {
	ConflictError,
	type AnalyzeMode,
	type Preset,
	type PostProcessRequest,
	type RequestMode
} from "@helios/contracts";
import { isDuplicateKeyError } from "../db";
import { requests, type MediaAsset, type PipelineRequest } from "../models";
import { enqueueAnalyze } from "./enqueueAnalyze";
import { launchRequest } from "./launchRequest";
import { resolvePostProcess } from "./resolvePostProcess";

export class RequestIdConflictError extends ConflictError {
	constructor(requestId: string) {
		super(`Request ${requestId} already exists for a different asset or mode`);
	}
}

interface CreateRequestBase {
	requestId?: string;
	asset: MediaAsset;
	callbackUrl?: string;
	analyze: AnalyzeMode;
}

export type CreateRequestInput = CreateRequestBase &
	({ mode: "purge" } | { mode: Exclude<RequestMode, "purge">; preset: Preset; postProcess?: PostProcessRequest });

export interface CreateRequestResult {
	request: PipelineRequest;
	created: boolean;
}

export async function createRequest(input: CreateRequestInput): Promise<CreateRequestResult> {
	const now = new Date();
	const _id = randomUUID();
	const clientRequestId = input.requestId ?? _id;
	const filter = { accountId: input.asset.accountId, clientRequestId };
	const existing = await requests().findOne(filter);
	if (existing !== null) {
		return { request: await resume(existing, input), created: false };
	}
	const doc = buildRequestDoc(_id, clientRequestId, input, now);
	const inserted = await insertRequestIfAbsent(doc);
	if (inserted !== null) {
		return { request: await resume(inserted, input), created: false };
	}
	return { request: await resume(doc, input), created: true };
}

async function resume(request: PipelineRequest, input: CreateRequestInput): Promise<PipelineRequest> {
	if (request.assetId !== input.asset._id || request.mode !== input.mode) {
		throw new RequestIdConflictError(request.clientRequestId);
	}
	if (request.status === "ANALYZING" && input.asset.sourceMetadata === undefined) {
		if (request.analyze === "async") {
			await enqueueAnalyze(request._id);
		}
		return request;
	}
	return launchRequest(request._id);
}

function canLaunch(mode: RequestMode, asset: MediaAsset): boolean {
	return mode === "purge" || asset.sourceMetadata !== undefined;
}

function buildRequestDoc(_id: string, clientRequestId: string, input: CreateRequestInput, now: Date): PipelineRequest {
	const { asset, mode } = input;
	return {
		_id,
		clientRequestId,
		accountId: asset.accountId,
		assetId: asset._id,
		mode,
		analyze: input.analyze,
		...presetFields(input),
		assetVersion: mode === "reencode" ? asset.version + 1 : asset.version,
		pendingItems: [],
		status: canLaunch(mode, asset) ? "IN_PROGRESS" : "ANALYZING",
		...(input.callbackUrl !== undefined && { callbackUrl: input.callbackUrl }),
		createdAt: now
	};
}

function presetFields(input: CreateRequestInput): Pick<PipelineRequest, "presetSnapshot" | "postProcess"> {
	if (input.mode === "purge") {
		return {};
	}
	return {
		presetSnapshot: input.preset,
		postProcess: resolvePostProcess(input.postProcess, input.preset.postProcess)
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
