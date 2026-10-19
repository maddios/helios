export class ImageHttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string
	) {
		super(code);
		this.name = "ImageHttpError";
	}
}
