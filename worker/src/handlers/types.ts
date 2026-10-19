import type { ItemOutput, MediaAsset, PipelineItem, PipelineRequest, UsageMeter } from "@helios/core";

export interface HandlerContext {
	item: PipelineItem;
	request: PipelineRequest;
	asset: MediaAsset;
	slug: string;
	workDir: string;
	signal: AbortSignal;
	meter: UsageMeter;
	reportProgress: (pct: number) => void;
}

export interface HandlerResult {
	output: ItemOutput;
	outputBytes?: number;
}

export type ItemHandler = (ctx: HandlerContext) => Promise<HandlerResult>;
