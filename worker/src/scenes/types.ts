import type { Person, Product, SceneAnalysisResult, TranscriptSegment } from "@helios/contracts";
import type { ModelEffort, UsageMeter } from "@helios/core";

export interface StillInput {
	index: number;
	timestampSec: number;
	key: string;
}

export interface ResolvedStill {
	index: number;
	timestampSec: number;
	imageUrl: string;
}

export interface TranscriptInput {
	language: string;
	segments: TranscriptSegment[];
}

export interface SceneOptions {
	effort: ModelEffort;
	temperature: number;
	peopleAttributes: boolean;
	signal: AbortSignal;
	meter: UsageMeter;
}

export interface AnalyzeScenesInput extends SceneOptions {
	durationSec: number;
	stills: StillInput[];
	resolveImage: (key: string) => Promise<string>;
	imageConcurrency: number;
	transcript: TranscriptInput | null;
	maxStills: number;
	windowSec: number;
	snapToleranceSec: number;
}

export interface AnalyzeImageInput extends SceneOptions {
	imageUrl: string;
}

export interface DraftScene {
	startSec: number;
	reasonForTransition: string;
	transcriptExcerpt: string | null;
	description: string;
	setting: string;
	products: Product[];
	people: Person[];
	representativeStillIndex: number;
	continuesPrevious: boolean;
}

export type AnalysisSummary = SceneAnalysisResult["summary"];

export class SceneInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SceneInputError";
	}
}

export class SceneOutputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SceneOutputError";
	}
}
