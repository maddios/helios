const ENGLISH = "en";

export interface TranscriptTargetsInput {
	native: string;
	english: boolean;
	translations: string[];
}

export function resolveTargets({ native, english, translations }: TranscriptTargetsInput): string[] {
	const requested = english && native !== ENGLISH ? [ENGLISH, ...translations] : translations;
	return [...new Set(requested)].filter((language) => language !== native).sort();
}
