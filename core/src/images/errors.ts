export type ImageErrorCode =
	| "malformed_param"
	| "unknown_param"
	| "duplicate_param"
	| "invalid_value"
	| "missing_dimension"
	| "not_applicable"
	| "invalid_path"
	| "invalid_key"
	| "non_canonical";

export class ImageError extends Error {
	constructor(
		readonly code: ImageErrorCode,
		message: string
	) {
		super(message);
		this.name = "ImageError";
	}
}
