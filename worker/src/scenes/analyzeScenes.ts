import {
	type Scene,
	type SceneAnalysisResult,
	SummaryNoPeopleResultSchema,
	type TranscriptSegment
} from "@helios/contracts";
import { CHAT_MODELS, chatJson } from "@helios/core";
import {
	SCENES_PROMPT_VERSION,
	singleWindowSystemPrompt,
	summarySystemPrompt,
	summaryUserContent,
	windowedSystemPrompt,
	windowUserContent,
	type WindowPrompt
} from "../ai/prompts/scenes/v1";
import {
	assertStillsWithinScenes,
	resolveStills,
	resolveWindowDrafts,
	stitchDrafts,
	toCoverage,
	unionPeople
} from "./resolve";
import { sceneSchemas, type ModelDraft, type WindowedSummary } from "./schemas";
import { allowedTimesOf, planWindows, transcriptLinesIn, type SceneWindow } from "./windowing";
import {
	type AnalysisSummary,
	type AnalyzeScenesInput,
	type DraftScene,
	SceneInputError,
	type TranscriptInput
} from "./types";

interface PreviousScene {
	description: string;
	setting: string;
}

interface WindowResult {
	drafts: DraftScene[];
	summary?: WindowedSummary;
}

export async function analyzeScenes(input: AnalyzeScenesInput): Promise<SceneAnalysisResult> {
	const windows = planWindows(input.stills, input.durationSec, input.windowSec, input.maxStills);
	if (windows.length === 0) {
		throw new SceneInputError(`Asset has no stills within its ${input.durationSec}s duration`);
	}
	const windowed = windows.length > 1;
	const drafts: DraftScene[] = [];
	let singleSummary: WindowedSummary | undefined;
	let previous: PreviousScene | undefined;
	for (const window of windows) {
		const result = await analyzeWindow(input, window, previous, windowed);
		drafts.push(...result.drafts);
		singleSummary = result.summary;
		const last = result.drafts.at(-1);
		previous = last === undefined ? previous : { description: last.description, setting: last.setting };
	}
	const scenes = toCoverage(stitchDrafts(drafts), input.durationSec);
	assertStillsWithinScenes(scenes, input.stills);
	return {
		promptVersion: SCENES_PROMPT_VERSION,
		model: CHAT_MODELS[input.effort],
		transcriptLanguage: input.transcript?.language ?? null,
		summary: windowed ? await windowedSummary(input, scenes) : singleWindowSummary(singleSummary),
		scenes
	};
}

async function analyzeWindow(
	input: AnalyzeScenesInput,
	window: SceneWindow,
	previous: PreviousScene | undefined,
	windowed: boolean
): Promise<WindowResult> {
	const lines = input.transcript === null ? [] : transcriptLinesIn(input.transcript.segments, window);
	const allowed = allowedTimesOf(window, lines);
	const prompt: WindowPrompt = {
		durationSec: input.durationSec,
		startSec: window.startSec,
		endSec: window.endSec,
		stills: await resolveStills(window.stills, input.resolveImage, input.imageConcurrency, input.signal),
		allowedTimes: allowed,
		transcript: transcriptOf(input.transcript, lines),
		previous: previous ?? null
	};
	const schemas = sceneSchemas(input.peopleAttributes);
	const request = {
		effort: input.effort,
		user: windowUserContent(prompt),
		temperature: input.temperature,
		meter: input.meter,
		signal: input.signal
	};
	const output: { scenes: ModelDraft[]; summary?: WindowedSummary } = windowed
		? await chatJson({
				...request,
				system: windowedSystemPrompt(input.peopleAttributes),
				schema: schemas.windowed,
				schemaName: "scene_windowed"
			})
		: await chatJson({
				...request,
				system: singleWindowSystemPrompt(input.peopleAttributes),
				schema: schemas.window,
				schemaName: "scene_window"
			});
	return {
		drafts: resolveWindowDrafts(output.scenes, window, allowed, input.snapToleranceSec, previous !== undefined),
		summary: output.summary
	};
}

function transcriptOf(transcript: TranscriptInput | null, lines: TranscriptSegment[]): WindowPrompt["transcript"] {
	return transcript === null ? null : { language: transcript.language, lines };
}

function singleWindowSummary(summary: WindowedSummary | undefined): AnalysisSummary {
	if (summary === undefined) {
		throw new SceneInputError("Scene analysis produced no summary");
	}
	return { ...summary, people: summary.people ?? [] };
}

async function windowedSummary(input: AnalyzeScenesInput, scenes: Scene[]): Promise<AnalysisSummary> {
	const { summary } = await chatJson({
		effort: input.effort,
		system: summarySystemPrompt(),
		user: summaryUserContent(input.durationSec, scenes),
		schema: SummaryNoPeopleResultSchema,
		schemaName: "scene_summary",
		temperature: input.temperature,
		meter: input.meter,
		signal: input.signal
	});
	return { ...summary, people: unionPeople(scenes) };
}
