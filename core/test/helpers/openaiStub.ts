import http from "node:http";
import type { AddressInfo } from "node:net";

export interface StubReply {
	status: number;
	body: unknown;
	headers?: Record<string, string>;
	delayMs?: number;
	reset?: boolean;
}

export interface StubRequest {
	url: string;
	authorization: string;
	contentType: string;
	body: Buffer;
}

export interface OpenAIStub {
	url: string;
	requests: StubRequest[];
	close(): Promise<void>;
}

export function chatReply(content: unknown, promptTokens = 10, completionTokens = 3): StubReply {
	return {
		status: 200,
		body: {
			choices: [{ message: { content: JSON.stringify(content), refusal: null } }],
			usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens }
		}
	};
}

export async function startOpenAIStub(replies: StubReply[]): Promise<OpenAIStub> {
	const requests: StubRequest[] = [];
	const server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			requests.push({
				url: req.url ?? "",
				authorization: req.headers.authorization ?? "",
				contentType: req.headers["content-type"] ?? "",
				body: Buffer.concat(chunks)
			});
			const reply = replies[Math.min(requests.length, replies.length) - 1];
			if (reply.reset === true) {
				req.socket.destroy();
				return;
			}
			setTimeout(() => {
				res.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
				res.end(JSON.stringify(reply.body));
			}, reply.delayMs ?? 0);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		requests,
		close: () =>
			new Promise((resolve, reject) => {
				server.closeAllConnections();
				server.close((err) => (err ? reject(err) : resolve()));
			})
	};
}
