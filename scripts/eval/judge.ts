import type { Scene } from "@helios/contracts";
import { chatJson, UsageMeter } from "@helios/core";
import { z } from "zod";
import type { EvalSample, JudgeScores } from "./types";

const TRANSCRIPT_EXCERPT_CHARS = 3000;
const SCORE = z.int().min(1).max(5);

const JudgeScoresSchema = z.object({
	boundaryQuality: SCORE.describe("1-5: do scene boundaries fall where the content changes"),
	descriptionAccuracy: SCORE.describe("1-5: do the Helios descriptions match the content and transcript"),
	completeness: SCORE.describe("1-5: are the meaningful changes covered, without missing or invented scenes"),
	rationale: z.string().describe("One line explaining the scores")
});

const JUDGE_SYSTEM =
	"You grade scene detection for one video. Use the transcript excerpt and both scene lists. " +
	"The partnrup scenes come from another system and may be wrong. Score each criterion from 1 (poor) to 5 (excellent).";

export async function judgeSample(sample: EvalSample, scenes: Scene[]): Promise<JudgeScores> {
	return chatJson({
		effort: "high",
		system: JUDGE_SYSTEM,
		user: judgeUserContent(sample, scenes),
		schema: JudgeScoresSchema,
		schemaName: "judge_scores",
		temperature: 0,
		meter: new UsageMeter(),
		signal: new AbortController().signal
	});
}

function judgeUserContent(sample: EvalSample, scenes: Scene[]): string {
	const transcript = sample.transcript
		.map((segment) => segment.text.trim())
		.join(" ")
		.slice(0, TRANSCRIPT_EXCERPT_CHARS);
	return [
		`Video duration: ${sample.durationSec}s`,
		"Partnrup scenes (start-end | reason | description):",
		...sample.baseline.scenes.map(
			(scene) => `- ${scene.startSec}s-${scene.endSec}s | ${scene.reason} | ${scene.description}`
		),
		"Helios scenes (start-end | reason | description):",
		...scenes.map(
			(scene) => `- ${scene.startSec}s-${scene.endSec}s | ${scene.reasonForTransition} | ${scene.description}`
		),
		"Transcript excerpt:",
		transcript
	].join("\n");
}
