import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Usage } from "@helios/contracts";
import {
	accounts,
	type Account,
	claimItem,
	completeItem,
	contextLogger,
	mediaAssets,
	recordFailedAttempt,
	releaseLease,
	renewLease,
	requests,
	type ClaimResult,
	type MediaAsset,
	type PipelineItem,
	type PipelineRequest,
	UsageMeter
} from "@helios/core";
import { config } from "./config";
import { FfmpegError } from "./ffmpeg/run";
import { startHeartbeat } from "./heartbeat";
import { handlerFor } from "./handlers/registry";
import { AssetDeletedError, SupersededError } from "./handlers/supersession";
import type { HandlerResult } from "./handlers/types";
import { SceneInputError } from "./scenes/types";

export type ItemOutcome = "done" | "redeliver" | "interrupted";

export interface ProcessItemInput {
	itemId: string;
	messageId: string;
	extendVisibility: (seconds: number) => Promise<void>;
	signal: AbortSignal;
	releaseLeaseOnAbort: boolean;
}

class CancelledError extends Error {
	constructor() {
		super("Item or request was cancelled");
		this.name = "CancelledError";
	}
}

class LeaseLostError extends Error {
	constructor() {
		super("Item lease was taken over by another worker");
		this.name = "LeaseLostError";
	}
}

const MS_PER_SEC = 1000;

interface ClaimedItem {
	item: PipelineItem;
	request: PipelineRequest;
	leaseId: string;
}

interface Attempt {
	input: ProcessItemInput;
	claim: ClaimedItem;
	startedAt: number;
	lease: AbortController;
	signal: AbortSignal;
	progress: { pct: number };
	meter: UsageMeter;
}

export async function processItem(input: ProcessItemInput): Promise<ItemOutcome> {
	const claim = await claimItem(input.itemId, input.messageId, config().LEASE_SEC);
	if (!claim.claimed) {
		return unclaimedOutcome(input, claim);
	}
	return runClaimed(input, claim);
}

async function unclaimedOutcome(
	{ itemId, messageId }: ProcessItemInput,
	claim: Exclude<ClaimResult, { claimed: true }>
): Promise<ItemOutcome> {
	if (claim.reason === "terminal") {
		await completeItem({ itemId, status: claim.status });
		return "done";
	}
	if (claim.reason === "busy") {
		return claim.messageId === messageId ? "redeliver" : "done";
	}
	return "done";
}

async function runClaimed(input: ProcessItemInput, claim: ClaimedItem): Promise<ItemOutcome> {
	const lease = new AbortController();
	const attempt: Attempt = {
		input,
		claim,
		startedAt: Date.now(),
		lease,
		signal: AbortSignal.any([input.signal, lease.signal]),
		progress: { pct: 0 },
		meter: new UsageMeter()
	};
	const stopHeartbeat = startHeartbeat({
		intervalSec: config().HEARTBEAT_SEC,
		beat: () => beat(attempt),
		onError: (err) => contextLogger({ itemId: input.itemId }).warn({ err }, "Heartbeat failed; retrying next tick")
	});
	let result: HandlerResult;
	try {
		result = await runHandler(attempt);
	} catch (err) {
		return failedOutcome(attempt, err);
	} finally {
		stopHeartbeat();
	}
	if (!(await renewLease(input.itemId, claim.leaseId))) {
		return "redeliver";
	}
	await completeItem({
		itemId: input.itemId,
		status: "COMPLETE",
		output: result.output,
		usage: attemptUsage(attempt, result.outputBytes)
	});
	return "done";
}

async function runHandler({ input, claim, signal, progress, meter }: Attempt): Promise<HandlerResult> {
	const { item, request } = claim;
	const { asset, account } = await loadAssetAndAccount(item);
	const workDir = path.join(config().WORK_DIR, item._id);
	await mkdir(workDir, { recursive: true });
	try {
		return await handlerFor(item.kind)({
			item,
			request,
			asset,
			account,
			workDir,
			signal,
			meter,
			reportProgress: (pct) => {
				progress.pct = pct;
			}
		});
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}

async function failedOutcome(attempt: Attempt, err: unknown): Promise<ItemOutcome> {
	const { input, claim, signal } = attempt;
	const { itemId } = input;
	const usage = attemptUsage(attempt);
	if (input.signal.aborted) {
		if (input.releaseLeaseOnAbort) {
			await releaseLease(itemId, claim.leaseId, usage);
		} else {
			await recordFailedAttempt({ itemId, leaseId: claim.leaseId, usage, error: errorText(input.signal.reason) });
		}
		return "interrupted";
	}
	if (signal.reason instanceof LeaseLostError) {
		return "redeliver";
	}
	if (signal.reason instanceof CancelledError) {
		await completeItem({ itemId, status: "CANCELLED", usage });
		return "done";
	}
	if (err instanceof SupersededError || err instanceof AssetDeletedError || err instanceof SceneInputError) {
		await completeItem({ itemId, status: "SKIPPED", error: err.message, usage });
		return "done";
	}
	await recordFailedAttempt({ itemId, leaseId: claim.leaseId, usage, error: errorText(err) });
	throw err;
}

async function beat({ input, claim, progress, lease }: Attempt): Promise<void> {
	if (!(await renewLease(claim.item._id, claim.leaseId, progress.pct))) {
		lease.abort(new LeaseLostError());
		return;
	}
	await input.extendVisibility(config().VISIBILITY_EXTENSION_SEC);
	if ((await requests().findOne({ _id: claim.item.requestId }))?.status === "CANCELLED") {
		lease.abort(new CancelledError());
	}
}

async function loadAssetAndAccount(item: PipelineItem): Promise<{ asset: MediaAsset; account: Account }> {
	const asset = await mediaAssets().findOne({ _id: item.assetId, accountId: item.accountId });
	if (asset === null) {
		throw new Error(`Asset ${item.assetId} not found for account ${item.accountId}`);
	}
	const account = await accounts().findOne({ _id: item.accountId });
	if (account === null) {
		throw new Error(`Account ${item.accountId} not found`);
	}
	return { asset, account };
}

function attemptUsage({ startedAt, meter }: Attempt, outputBytes?: number): Usage {
	const cfg = config();
	const common = {
		computeSec: elapsedSec(startedAt),
		...(outputBytes !== undefined && { outputBytes }),
		...meter.snapshot()
	};
	if (cfg.WORKER_TIER === "lambda") {
		return { computeTier: "lambda", memoryMb: cfg.AWS_LAMBDA_FUNCTION_MEMORY_SIZE, ...common };
	}
	return {
		computeTier: "fargate",
		memoryMb: cfg.WORKER_MEMORY_MB,
		vcpu: cfg.WORKER_VCPU,
		spot: cfg.WORKER_SPOT,
		...common
	};
}

function elapsedSec(startedAt: number): number {
	return (Date.now() - startedAt) / MS_PER_SEC;
}

function errorText(err: unknown): string {
	if (err instanceof FfmpegError && err.stderrTail !== "") {
		return err.stderrTail;
	}
	return err instanceof Error ? err.message : String(err);
}
