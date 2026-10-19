import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WEBHOOK_EVENT_HEADER, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TOLERANCE_SEC } from "@helios/contracts";
import { verifySignature } from "@helios/core";

export interface SinkEvent {
	event: string;
	body: Record<string, unknown>;
	verified: boolean;
	status: number;
}

export interface WebhookSink {
	url: string;
	events: SinkEvent[];
	respondWith(...statuses: number[]): void;
	close(): Promise<void>;
}

export function startWebhookSink({ secret }: { secret: () => string }): Promise<WebhookSink> {
	const events: SinkEvent[] = [];
	const queued: number[] = [];
	const server = http.createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk: Buffer) => {
			raw += chunk.toString();
		});
		req.on("end", () => {
			const verified = verifyRequest(req, raw, secret());
			const status = verified ? (queued.shift() ?? 200) : 401;
			events.push({
				event: headerValue(req, WEBHOOK_EVENT_HEADER),
				body: JSON.parse(raw) as Record<string, unknown>,
				verified,
				status
			});
			respond(res, status);
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			resolve({
				url: `http://127.0.0.1:${port}/hook`,
				events,
				respondWith: (...statuses) => {
					queued.push(...statuses);
				},
				close: () => new Promise((done) => server.close(() => done()))
			});
		});
	});
}

function verifyRequest(req: IncomingMessage, raw: string, secret: string): boolean {
	const signature = headerValue(req, WEBHOOK_SIGNATURE_HEADER);
	return verifySignature(secret, signature, raw, Math.floor(Date.now() / 1000), WEBHOOK_TOLERANCE_SEC);
}

function headerValue(req: IncomingMessage, name: string): string {
	const value = req.headers[name.toLowerCase()];
	return typeof value === "string" ? value : "";
}

function respond(res: ServerResponse, status: number): void {
	res.writeHead(status).end();
}
