import type { ItemEventName, ItemStatus, RequestEventName, RequestStatus, WebhookEvent } from "@helios/contracts";
import { files, jobReports, mediaAssets, pipelineItems, type PipelineItem, type PipelineRequest } from "../models";
import type { FileCallbackMessage } from "../pipeline";
import { toFileView } from "../files";
import { transcriptUrls } from "../transcripts";
import { toAssetViews, toOutputViews, toRequestView } from "../views";

const ITEM_EVENT_BY_STATUS: Partial<Record<ItemStatus, ItemEventName>> = {
	COMPLETE: "item.completed",
	ERROR: "item.failed",
	SKIPPED: "item.skipped",
	CANCELLED: "item.cancelled"
};

const REQUEST_EVENT_BY_STATUS: Partial<Record<RequestStatus, RequestEventName>> = {
	COMPLETE: "request.completed",
	ERROR: "request.failed",
	CANCELLED: "request.cancelled"
};

export async function itemEnvelope(
	id: string,
	createdAt: string,
	sequence: number,
	request: PipelineRequest,
	itemId: string
): Promise<WebhookEvent> {
	const item = await loadItem(itemId);
	const event = ITEM_EVENT_BY_STATUS[item.status];
	if (event === undefined) {
		throw new Error(`Item ${itemId} is not terminal (${item.status})`);
	}
	return {
		id,
		event,
		createdAt,
		sequence,
		data: {
			requestId: item.requestId,
			assetId: item.assetId,
			item: toWebhookItem(item),
			...(item.output?.assetOutputs !== undefined && {
				outputs: toOutputViews(item.output.assetOutputs, request.assetVersion)
			}),
			...(item.output?.scenes !== undefined && { scenes: item.output.scenes }),
			...(item.output?.transcripts !== undefined && {
				transcripts: item.output.transcripts.map(({ language, isTranslation, revision, keys }) => ({
					language,
					isTranslation,
					urls: transcriptUrls(keys, revision)
				}))
			})
		}
	};
}

export async function requestEnvelope(
	id: string,
	createdAt: string,
	sequence: number,
	request: PipelineRequest
): Promise<WebhookEvent> {
	const report = await jobReports().findOne({ _id: request._id });
	if (report === null) {
		throw new Error(`Job report for request ${request._id} is missing`);
	}
	const event = request.mode === "purge" ? "asset.deleted" : REQUEST_EVENT_BY_STATUS[report.status];
	if (event === undefined) {
		throw new Error(`Request ${request._id} has no callback event for status ${report.status}`);
	}
	const requestView = await toRequestView({
		...request,
		status: report.status,
		error: report.error,
		completedAt: report.completedAt
	});
	const [asset] = await toAssetViews(request.accountId, [await loadAsset(request)]);
	return { id, event, createdAt, sequence, data: { request: requestView, asset } };
}

export async function fileEnvelope(
	id: string,
	createdAt: string,
	message: FileCallbackMessage,
	fileId: string
): Promise<WebhookEvent> {
	const file = await files().findOne({ _id: fileId });
	if (file === null) {
		throw new Error(`File ${fileId} not found`);
	}
	return {
		id,
		event: message.event,
		createdAt,
		sequence: message.sequence,
		data: { file: toFileView(file) }
	};
}

async function loadItem(itemId: string): Promise<PipelineItem> {
	const item = await pipelineItems().findOne({ _id: itemId });
	if (item === null) {
		throw new Error(`Item ${itemId} not found`);
	}
	return item;
}

async function loadAsset(request: PipelineRequest) {
	const asset = await mediaAssets().findOne({ _id: request.assetId, accountId: request.accountId });
	if (asset === null) {
		throw new Error(`Asset ${request.assetId} not found for account ${request.accountId}`);
	}
	return asset;
}

function toWebhookItem(item: PipelineItem) {
	return {
		key: item.key,
		kind: item.kind,
		status: item.status,
		...(item.profile !== undefined && { profile: item.profile }),
		...(item.error !== undefined && { error: item.error })
	};
}
