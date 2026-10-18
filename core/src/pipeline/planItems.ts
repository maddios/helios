import type { EncodingProfile, Preset, RequestMode, ResolvedPostProcess, SourceMetadata } from "@helios/contracts";
import { isShortSource, routeItem } from "./route";
import type { Dependency, PlannedItem, Thresholds } from "./types";

export const AI_ITEM_PRIORITY = { transcribe: 20, scenes: 30 } as const;
const PURGE_ITEM_PRIORITY = 10;

const MAX_UPSCALE_PX = 100;

export interface MediaPlanInput {
	preset: Preset;
	source: SourceMetadata;
	postProcess: ResolvedPostProcess;
	mode: Exclude<RequestMode, "purge">;
	thresholds: Thresholds;
}

export interface PurgePlanInput {
	mode: "purge";
}

export type PlanInput = MediaPlanInput | PurgePlanInput;

export function planItems(input: PlanInput): PlannedItem[] {
	return input.mode === "purge" ? [purgeItem()] : planMediaItems(input);
}

function purgeItem(): PlannedItem {
	return {
		key: "purge",
		kind: "purge",
		queue: "fargate-p2",
		priority: PURGE_ITEM_PRIORITY,
		status: "QUEUED",
		dependsOn: []
	};
}

function planMediaItems({ preset, source, postProcess, mode, thresholds }: MediaPlanInput): PlannedItem[] {
	const isShort = isShortSource(source, thresholds);
	const encodeItems =
		mode === "postProcess" ? [] : encodeProfiles(preset, source).map((profile) => encodeItem(profile, mode, isShort));
	const transcribeItems =
		postProcess.transcribe === false || source.type === "image" ? [] : [transcribeItem(source, mode, isShort)];
	const sceneItems = postProcess.sceneDetection ? [sceneItem(preset, source, mode, transcribeItems, isShort)] : [];
	return [...encodeItems, ...transcribeItems, ...sceneItems];
}

function encodeProfiles(preset: Preset, source: SourceMetadata): EncodingProfile[] {
	const childNames = new Set(preset.profiles.flatMap((profile) => profile.children));
	return preset.profiles.filter(
		(profile) =>
			profile.sourceTypes.includes(source.type) && !childNames.has(profile.name) && isApplicable(profile, source)
	);
}

function isApplicable(profile: EncodingProfile, source: SourceMetadata): boolean {
	if (profile.type === "audio") {
		return source.hasAudio;
	}
	if (profile.type === "video" && !profile.isDefault) {
		return profile.params.height - MAX_UPSCALE_PX <= source.height;
	}
	return true;
}

function encodeItem(profile: EncodingProfile, mode: RequestMode, isShort: boolean): PlannedItem {
	return {
		key: profile.name,
		kind: "encode",
		profile: profile.name,
		queue: routeItem({ mode, kind: "encode", isDefault: profile.isDefault, isShort }),
		priority: profile.priority,
		status: "QUEUED",
		dependsOn: []
	};
}

function transcribeItem(source: SourceMetadata, mode: RequestMode, isShort: boolean): PlannedItem {
	return {
		key: "transcribe",
		kind: "transcribe",
		queue: routeItem({ mode, kind: "transcribe", isDefault: false, isShort }),
		priority: AI_ITEM_PRIORITY.transcribe,
		status: source.hasAudio ? "QUEUED" : "SKIPPED",
		dependsOn: []
	};
}

function sceneItem(
	preset: Preset,
	source: SourceMetadata,
	mode: RequestMode,
	transcribeItems: PlannedItem[],
	isShort: boolean
): PlannedItem {
	const dependsOn: Dependency[] = [
		...(mode === "postProcess" ? [] : defaultProfileKeys(preset, source).map((key) => ({ key, required: true }))),
		...transcribeItems.filter((item) => item.status !== "SKIPPED").map((item) => ({ key: item.key, required: false }))
	];
	return {
		key: "scenes",
		kind: "scenes",
		queue: routeItem({ mode, kind: "scenes", isDefault: false, isShort }),
		priority: AI_ITEM_PRIORITY.scenes,
		status: dependsOn.length > 0 ? "BLOCKED" : "QUEUED",
		dependsOn
	};
}

function defaultProfileKeys(preset: Preset, source: SourceMetadata): string[] {
	return preset.profiles
		.filter((profile) => profile.isDefault && profile.sourceTypes.includes(source.type))
		.map((profile) => profile.name);
}
