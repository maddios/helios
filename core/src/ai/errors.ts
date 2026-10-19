export class OpenAIError extends Error {
	readonly status: number | undefined;
	readonly code: string;
	readonly retryAfterMs: number | undefined;

	constructor(options: { status?: number; code: string; retryAfterMs?: number }) {
		super(`OpenAI request failed (openai_${options.status ?? "none"}_${options.code})`);
		this.name = "OpenAIError";
		this.status = options.status;
		this.code = options.code;
		this.retryAfterMs = options.retryAfterMs;
	}
}

export class ModelRefusalError extends Error {
	constructor() {
		super("Model refused the request");
		this.name = "ModelRefusalError";
	}
}

export class ModelOutputError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ModelOutputError";
	}
}

export class StrictSchemaError extends Error {
	constructor(path: string) {
		super(`Strict json_schema needs every property required; ${path} is optional. Use nullable instead.`);
		this.name = "StrictSchemaError";
	}
}

export class UnknownLanguageError extends Error {
	constructor(language: string) {
		super(`Unknown transcription language: ${language}`);
		this.name = "UnknownLanguageError";
	}
}
