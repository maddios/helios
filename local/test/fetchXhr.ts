/**
 * A test-only `XMLHttpRequest` over `fetch`, with the subset the browser uploader uses: PUT with a Blob body, request
 * headers, abort and response headers. Browsers report upload progress, so this one reports the whole body once it is
 * sent, which is enough for the upload path under test.
 */
export class FetchXhr {
	/** Answers a URL without a network call when it returns a response, for example to simulate an expired URL. */
	static interceptor: ((url: string) => Response | undefined) | undefined;
	status = 0;
	upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	private method = "";
	private url = "";
	private readonly requestHeaders = new Headers();
	private responseHeaders = new Headers();
	private readonly controller = new AbortController();

	open(method: string, url: string): void {
		this.method = method;
		this.url = url;
	}

	setRequestHeader(name: string, value: string): void {
		this.requestHeaders.set(name, value);
	}

	getResponseHeader(name: string): string | null {
		return this.responseHeaders.get(name);
	}

	abort(): void {
		this.controller.abort();
	}

	send(body: Blob): void {
		this.upload.onprogress?.({ loaded: body.size });
		const intercepted = FetchXhr.interceptor?.(this.url);
		const request =
			intercepted === undefined
				? fetch(this.url, {
						method: this.method,
						body,
						headers: this.requestHeaders,
						signal: this.controller.signal
					})
				: Promise.resolve(intercepted);
		request
			.then(async (res) => {
				this.status = res.status;
				this.responseHeaders = res.headers;
				await res.arrayBuffer();
				this.onload?.();
			})
			.catch(() => {
				if (this.controller.signal.aborted) {
					this.onabort?.();
				} else {
					this.onerror?.();
				}
			});
	}
}
