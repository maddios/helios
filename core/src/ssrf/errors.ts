import { UnprocessableError, ValidationError } from "@helios/contracts";

export class UnsafeUrlError extends ValidationError {
	constructor(message: string) {
		super(message, undefined, "unsafe_url");
	}
}

export class UnprocessableSourceError extends UnprocessableError {
	constructor(message: string) {
		super(message, undefined, "unprocessable_source");
	}
}

export class ResponseTooLargeError extends UnprocessableError {
	constructor(maxBytes: number) {
		super(`Response body exceeds ${maxBytes} bytes`, undefined, "too_large");
	}
}
