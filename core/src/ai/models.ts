export type ModelEffort = "low" | "medium" | "high";

export const CHAT_MODELS: Record<ModelEffort, string> = {
	low: "gpt-6-luna",
	medium: "gpt-6-sol",
	high: "gpt-6-astra"
};

export const TRANSCRIPTION_MODEL = "whisper-1";
