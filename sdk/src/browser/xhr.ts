import { abortedError, NetworkError } from "./errors.js";

/** One PUT of a body to a presigned URL, with upload progress. */
export interface PutRequest {
	url: string;
	body: Blob;
	headers: Record<string, string>;
	partNumber?: number;
	onUploadProgress?: (loadedBytes: number) => void;
	signal?: AbortSignal;
}

/** The status and ETag of a PUT response. */
export interface PutResponse {
	status: number;
	etag: string | null;
}

/** The part of `XMLHttpRequest` the uploader uses, declared here so the SDK compiles without the DOM library. */
interface XhrLike {
	status: number;
	upload: { onprogress: ((event: { loaded: number }) => void) | null };
	onload: (() => void) | null;
	onerror: (() => void) | null;
	onabort: (() => void) | null;
	open(method: string, url: string): void;
	setRequestHeader(name: string, value: string): void;
	getResponseHeader(name: string): string | null;
	send(body: Blob): void;
	abort(): void;
}

interface XhrGlobal {
	XMLHttpRequest: new () => XhrLike;
}

/**
 * PUTs a body with `XMLHttpRequest`, which is the only browser API that reports upload progress. Aborting the signal
 * aborts the request.
 *
 * @param request URL, body, headers, progress callback and cancellation.
 * @returns The status and the `ETag` response header, or `null` when it is not exposed.
 * @throws {NetworkError} When no response arrives.
 * @throws {BrowserUploadError} With code `aborted` when the signal fires.
 */
export function putBlob(request: PutRequest): Promise<PutResponse> {
	return new Promise((resolve, reject) => {
		const { signal } = request;
		if (signal?.aborted) {
			reject(abortedError(signal.reason));
			return;
		}
		const Xhr = (globalThis as unknown as XhrGlobal).XMLHttpRequest;
		const xhr = new Xhr();
		const onAbort = (): void => xhr.abort();
		const detach = (): void => signal?.removeEventListener("abort", onAbort);
		xhr.open("PUT", request.url);
		for (const [name, value] of Object.entries(request.headers)) {
			xhr.setRequestHeader(name, value);
		}
		xhr.upload.onprogress = (event) => request.onUploadProgress?.(event.loaded);
		xhr.onload = () => {
			detach();
			resolve({ status: xhr.status, etag: xhr.getResponseHeader("ETag") });
		};
		xhr.onerror = () => {
			detach();
			reject(new NetworkError(request.partNumber));
		};
		xhr.onabort = () => {
			detach();
			reject(abortedError(signal?.reason));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		xhr.send(request.body);
	});
}
