/** A PUT the fake XMLHttpRequest received. */
export interface XhrCall {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: Blob;
}

/** How the fake answers one PUT. Omitted fields take the success defaults. */
export interface XhrReply {
	status?: number;
	etag?: string | null;
	networkError?: boolean;
	delayMs?: number;
}

/** Decides the reply for each PUT, in call order. */
export type XhrResponder = (call: XhrCall) => XhrReply;

/** What the fake recorded while it was installed. */
export interface FakeXhrRun {
	calls: XhrCall[];
	peakInFlight: number;
	abortedInFlight: number;
	inFlight: number;
}

/**
 * Replaces the global `XMLHttpRequest` with a fake that answers each PUT after a delay. It fires upload progress halfway
 * and at the end, then `onload`, `onerror` or `onabort`, like a browser does.
 *
 * @param responder Decides the reply for each PUT.
 * @returns The recorded run and a `restore` function.
 */
export function installFakeXhr(responder: XhrResponder): FakeXhrRun & { restore(): void } {
	const run: FakeXhrRun = { calls: [], peakInFlight: 0, abortedInFlight: 0, inFlight: 0 };
	const globals = globalThis as unknown as { XMLHttpRequest?: unknown };
	const previous = globals.XMLHttpRequest;

	class FakeXhr {
		status = 0;
		upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		onabort: (() => void) | null = null;
		private call: XhrCall = { method: "", url: "", headers: {}, body: new Blob([]) };
		private etag: string | null = null;
		private settled = false;
		private timer: ReturnType<typeof setTimeout> | undefined;

		open(method: string, url: string): void {
			this.call = { method, url, headers: {}, body: new Blob([]) };
		}

		setRequestHeader(name: string, value: string): void {
			this.call.headers[name] = value;
		}

		getResponseHeader(name: string): string | null {
			return name.toLowerCase() === "etag" ? this.etag : null;
		}

		send(body: Blob): void {
			this.call.body = body;
			run.calls.push(this.call);
			run.inFlight++;
			run.peakInFlight = Math.max(run.peakInFlight, run.inFlight);
			const reply = responder(this.call);
			this.timer = setTimeout(() => this.finish(reply), reply.delayMs ?? 1);
		}

		abort(): void {
			if (this.settled) {
				return;
			}
			this.settle();
			run.abortedInFlight++;
			this.onabort?.();
		}

		private finish(reply: XhrReply): void {
			if (this.settled) {
				return;
			}
			this.settle();
			if (reply.networkError) {
				this.onerror?.();
				return;
			}
			const size = this.call.body.size;
			this.upload.onprogress?.({ loaded: Math.floor(size / 2) });
			this.upload.onprogress?.({ loaded: size });
			this.status = reply.status ?? 200;
			this.etag = reply.etag === undefined ? `"${this.call.url.split("/").pop()}"` : reply.etag;
			this.onload?.();
		}

		private settle(): void {
			this.settled = true;
			clearTimeout(this.timer);
			run.inFlight--;
		}
	}

	globals.XMLHttpRequest = FakeXhr;
	return Object.assign(run, {
		restore(): void {
			globals.XMLHttpRequest = previous;
		}
	});
}
