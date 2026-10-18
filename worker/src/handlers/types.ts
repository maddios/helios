import type { ItemOutput, MediaAsset, PipelineItem, PipelineRequest } from "@helios/core";

export interface HandlerContext {
	item: PipelineItem;
	request: PipelineRequest;
	asset: MediaAsset;
	slug: string;
	workDir: string;
	signal: AbortSignal;
	reportProgress: (pct: number) => void;
}

export interface HandlerResult {
	output: ItemOutput;
	outputBytes: number;
}

export type ItemHandler = (ctx: HandlerContext) => Promise<HandlerResult>;
