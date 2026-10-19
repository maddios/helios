import { execFile } from "node:child_process";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { languageName } from "@helios/core";
import { loadLocalConfig } from "./loadConfig";

const execFileAsync = promisify(execFile);
const TRANSCRIPTIONS_PATH = "/v1/audio/transcriptions";
const CHAT_PATH = "/v1/chat/completions";
const SEGMENT_SEC = 5;
const LEAD_IN_SEC = 0.5;
const CHARS_PER_TOKEN = 4;

export interface MockFailure {
	path: typeof TRANSCRIPTIONS_PATH | typeof CHAT_PATH;
	status: number;
	times: number;
}

export interface OpenAiMock {
	setFailures(failures: MockFailure[]): void;
	close(): Promise<void>;
}

export interface OpenAiMockOptions {
	port: number;
	language: string;
}

interface Reply {
	status: number;
	body: unknown;
}

export async function startOpenAiMock({ port, language }: OpenAiMockOptions): Promise<OpenAiMock> {
	let failures: MockFailure[] = [];
	const server = http.createServer(async (req, res) => {
		const reply = await route(req, await readBody(req), language, failures).catch((err: unknown): Reply => ({
			status: 500,
			body: { error: { message: String(err) } }
		}));
		res.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify(reply.body));
	});
	await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
	return {
		setFailures: (next) => {
			failures = next.map((rule) => ({ ...rule }));
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			})
	};
}

async function route(
	req: http.IncomingMessage,
	body: Buffer,
	language: string,
	failures: MockFailure[]
): Promise<Reply> {
	const forced = takeFailure(failures, req.url);
	if (forced !== undefined) {
		return { status: forced.status, body: { error: { message: "forced failure" } } };
	}
	if (req.method === "POST" && req.url === TRANSCRIPTIONS_PATH) {
		return { status: 200, body: await transcription(body, req.headers["content-type"] ?? "", language) };
	}
	if (req.method === "POST" && req.url === CHAT_PATH) {
		return { status: 200, body: chatCompletion(body) };
	}
	return { status: 404, body: { error: { message: `no mock for ${req.method} ${req.url}` } } };
}

function takeFailure(failures: MockFailure[], url: string | undefined): MockFailure | undefined {
	const rule = failures.find((candidate) => candidate.path === url && candidate.times > 0);
	if (rule !== undefined) {
		rule.times -= 1;
	}
	return rule;
}

async function transcription(body: Buffer, contentType: string, fallbackLanguage: string) {
	const fields = parseMultipart(body, contentType);
	const audio = fields.get("file");
	if (audio === undefined) {
		throw new Error("transcription request has no file part");
	}
	const duration = await probeDuration(audio);
	const segments = segmentsFor(duration);
	return {
		task: "transcribe",
		language: detectedLanguage(fields.get("language"), fallbackLanguage),
		duration,
		text: segments.map((segment) => segment.text).join(" "),
		segments
	};
}

function detectedLanguage(hint: Buffer | undefined, fallback: string): string {
	if (hint === undefined) {
		return fallback;
	}
	const code = hint.toString("utf8");
	const name = languageName(code);
	if (name === undefined) {
		throw new Error(`no language name for hint ${code}`);
	}
	return name;
}

function segmentsFor(duration: number) {
	const segments: { id: number; start: number; end: number; text: string }[] = [];
	for (let start = LEAD_IN_SEC; start < duration; start += SEGMENT_SEC) {
		const id = segments.length;
		segments.push({ id, start, end: Math.min(duration, start + SEGMENT_SEC - LEAD_IN_SEC), text: `seg ${id}` });
	}
	return segments;
}

function chatCompletion(body: Buffer) {
	const request = JSON.parse(body.toString("utf8")) as { model: string; messages: { role: string; content: string }[] };
	const user = request.messages.find((message) => message.role === "user");
	if (user === undefined) {
		throw new Error("chat request has no user message");
	}
	const { segments } = JSON.parse(user.content) as { segments: { index: number; text: string }[] };
	const content = JSON.stringify({
		segments: segments.map((segment) => ({ index: segment.index, text: `EN: ${segment.text}` }))
	});
	return {
		id: "chatcmpl-mock",
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: request.model,
		choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
		usage: {
			prompt_tokens: Math.ceil(user.content.length / CHARS_PER_TOKEN),
			completion_tokens: Math.ceil(content.length / CHARS_PER_TOKEN),
			total_tokens: Math.ceil((user.content.length + content.length) / CHARS_PER_TOKEN)
		}
	};
}

function parseMultipart(body: Buffer, contentType: string): Map<string, Buffer> {
	const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
	const boundary = match?.[1] ?? match?.[2];
	if (boundary === undefined) {
		throw new Error("multipart request has no boundary");
	}
	const fields = new Map<string, Buffer>();
	for (const part of body.toString("latin1").split(`--${boundary}`).slice(1, -1)) {
		const headerEnd = part.indexOf("\r\n\r\n");
		const name = /name="([^"]+)"/.exec(part.slice(0, headerEnd))?.[1];
		if (name !== undefined) {
			fields.set(name, Buffer.from(part.slice(headerEnd + 4, -2), "latin1"));
		}
	}
	return fields;
}

async function probeDuration(audio: Buffer): Promise<number> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "openai-mock-"));
	try {
		const file = path.join(dir, "audio.mp3");
		await writeFile(file, audio);
		const { stdout } = await execFileAsync(loadLocalConfig().analyze.ffprobePath, [
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"csv=p=0",
			file
		]);
		return Number(stdout.trim());
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

if (require.main === module) {
	const { openai } = loadLocalConfig();
	startOpenAiMock({ port: openai.mockPort, language: openai.mockLanguage }).catch((err: unknown) => {
		console.error(err);
		process.exitCode = 1;
	});
}
