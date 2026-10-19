import {
	QueueNameSchema,
	type ImageSourceMetadata,
	type QueueName,
	type RequestMode,
	type RequestStatus,
	type ResolvedPostProcess,
	type VideoSourceMetadata
} from "@helios/contracts";
import {
	mediaAssets,
	pipelineItems,
	requests,
	type MediaAsset,
	type PipelineItem,
	type PipelineRequest
} from "../../src/models";
import {
	planItems,
	type CallbackMessage,
	type CreateRequestInput,
	type ItemMessage,
	type PlannedItem
} from "../../src/pipeline";
import { genericPreset } from "../../src/presets";
import { queueFor } from "../../src/queue";

export const SENT_QUEUES: QueueName[] = ["lambda-p1", "fargate-p2", "lambda-ai"];
export const thresholds = { maxDurationSec: 180, maxSourceBytes: 524288000 };
export const allPostProcess: ResolvedPostProcess = {
	transcribe: { translations: [], english: true, retranscribe: false },
	sceneDetection: true
};

export const videoSource: VideoSourceMetadata = {
	type: "video",
	sizeBytes: 1000000,
	width: 1920,
	height: 1080,
	durationSec: 60,
	fps: 30,
	videoCodec: "h264",
	hasAudio: true
};

export const imageSource: ImageSourceMetadata = {
	type: "image",
	sizeBytes: 1000000,
	width: 1920,
	height: 1080,
	hasAudio: false
};

export const asset: MediaAsset = {
	_id: "asset-1",
	accountId: "account-1",
	source: { type: "s3", bucket: "bucket", key: "source.mp4" },
	sourceMetadata: videoSource,
	presetName: "generic",
	presetVersion: 1,
	presetSnapshot: genericPreset,
	version: 1,
	outputs: {},
	createdAt: new Date(),
	updatedAt: new Date()
};

export const unanalyzedAsset: MediaAsset = {
	_id: "asset-raw",
	accountId: "account-1",
	source: { type: "s3", bucket: "bucket", key: "raw.mp4" },
	presetName: "generic",
	presetVersion: 1,
	presetSnapshot: genericPreset,
	version: 1,
	outputs: {},
	createdAt: new Date(),
	updatedAt: new Date()
};

export function createInput(overrides: Partial<CreateRequestInput> = {}): CreateRequestInput {
	return { requestId: "req-1", asset, mode: "encode", preset: genericPreset, analyze: "sync", ...overrides };
}

export function sendBatchOf(queue: QueueName) {
	return jest.mocked(queueFor<ItemMessage>(queue).sendBatch);
}

export function sentMessages(queue: QueueName) {
	return sendBatchOf(queue).mock.calls.flatMap(([messages]) => messages);
}

export function totalSendCalls(): number {
	return QueueNameSchema.options.reduce((total, queue) => total + sendBatchOf(queue).mock.calls.length, 0);
}

export function sentCallbacks(): CallbackMessage[] {
	return jest.mocked(queueFor<CallbackMessage>("callbacks.fifo").send).mock.calls.map(([message]) => message.body);
}

export function expectSentKeys(requestId: string, expected: Partial<Record<QueueName, string[]>>): void {
	for (const queue of QueueNameSchema.options) {
		expect(sentMessages(queue).map((message) => message.body)).toEqual(
			(expected[queue] ?? []).map((key) => ({ itemId: `${requestId}:${key}` }))
		);
	}
}

export async function itemsOf(request: PipelineRequest): Promise<Record<string, PipelineItem>> {
	const items = await pipelineItems().find({ requestId: request._id }).toArray();
	return Object.fromEntries(items.map((item) => [item._id, item]));
}

export function planFor(
	mode: Exclude<RequestMode, "purge">,
	source: VideoSourceMetadata | ImageSourceMetadata = videoSource
): PlannedItem[] {
	return planItems({ preset: genericPreset, source, postProcess: allPostProcess, mode, thresholds });
}

function plannedItemDocs(requestId: string, plan: PlannedItem[]): PipelineItem[] {
	const itemId = (key: string) => `${requestId}:${key}`;
	return plan.map((item) => ({
		_id: itemId(item.key),
		key: item.key,
		requestId,
		assetId: "asset-1",
		accountId: "account-1",
		kind: item.kind,
		...(item.profile !== undefined && { profile: item.profile }),
		queue: item.queue,
		priority: item.priority,
		status: item.status,
		pendingDeps: item.dependsOn.map((dep) => itemId(dep.key)),
		requiredDeps: item.dependsOn.filter((dep) => dep.required).map((dep) => itemId(dep.key)),
		dependents: plan
			.filter((other) => other.dependsOn.some((dep) => dep.key === item.key))
			.map((other) => itemId(other.key)),
		usage: [],
		attempts: 0,
		progress: 0,
		createdAt: new Date()
	}));
}

export async function insertStoredRequest(
	requestId: string,
	{
		mode = "encode",
		assetVersion = 1,
		status = "IN_PROGRESS",
		itemKeys
	}: {
		mode?: Exclude<RequestMode, "purge">;
		assetVersion?: number;
		status?: RequestStatus;
		itemKeys?: string[];
	} = {}
): Promise<void> {
	const docs = plannedItemDocs(requestId, planFor(mode));
	await requests().insertOne({
		_id: requestId,
		clientRequestId: requestId,
		accountId: "account-1",
		assetId: "asset-1",
		mode,
		analyze: "sync",
		presetSnapshot: genericPreset,
		postProcess: allPostProcess,
		assetVersion,
		pendingItems: docs.filter((doc) => doc.status !== "SKIPPED").map((doc) => doc._id),
		status,
		createdAt: new Date()
	});
	const inserted =
		itemKeys === undefined ? docs : docs.filter((doc) => itemKeys.includes(doc._id.slice(requestId.length + 1)));
	if (inserted.length > 0) {
		await pipelineItems().insertMany(inserted);
	}
}
