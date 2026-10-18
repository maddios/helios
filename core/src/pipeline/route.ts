import type { ItemKind, ItemQueueName, RequestMode, SourceMetadata } from "@helios/contracts";
import type { Thresholds } from "./types";

export function isShortSource(source: SourceMetadata, thresholds: Thresholds): boolean {
	return (
		source.sizeBytes <= thresholds.maxSourceBytes &&
		(source.type === "image" || source.durationSec <= thresholds.maxDurationSec)
	);
}

export interface RouteInput {
	mode: RequestMode;
	kind: ItemKind;
	isDefault: boolean;
	isShort: boolean;
}

export function routeItem({ mode, kind, isDefault, isShort }: RouteInput): ItemQueueName {
	if (mode === "reencode") {
		return "fargate-p4";
	}
	if (kind === "encode") {
		return encodeQueue(isDefault, isShort);
	}
	return isShort ? "lambda-ai" : "fargate-p3";
}

function encodeQueue(isDefault: boolean, isShort: boolean): ItemQueueName {
	if (!isDefault) {
		return "fargate-p2";
	}
	return isShort ? "lambda-p1" : "fargate-p1";
}
