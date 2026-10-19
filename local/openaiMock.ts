import { execFile } from "node:child_process";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { languageCode, languageName } from "@helios/core";
import { loadLocalConfig } from "./loadConfig";

const execFileAsync = promisify(execFile);
const TRANSCRIPTIONS_PATH = "/v1/audio/transcriptions";
const CHAT_PATH = "/v1/chat/completions";
const SEGMENT_SEC = 5;
const LEAD_IN_SEC = 0.5;
const CHARS_PER_TOKEN = 4;
const CHAT_DELAY_MS = 25;

export interface MockFailure {
	path: typeof TRANSCRIPTIONS_PATH | typeof CHAT_PATH;
	status: number;
	times: number;
}

export type SceneContinuation = "window-start" | "mid-window";

export interface OpenAiMock {
	setFailures(failures: MockFailure[]): void;
	setSceneContinuation(mode: SceneContinuation): void;
	requestCount(path: MockFailure["path"]): number;
	peakChatConcurrency(): number;
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

interface ChatStats {
	inFlight: number;
	peak: number;
}

export async function startOpenAiMock({ port, language }: OpenAiMockOptions): Promise<OpenAiMock> {
	let failures: MockFailure[] = [];
	const requests = new Map<string, number>();
	const chat: ChatStats = { inFlight: 0, peak: 0 };
	const scenes = { continuation: "window-start" as SceneContinuation };
	const server = http.createServer(async (req, res) => {
		requests.set(req.url ?? "", (requests.get(req.url ?? "") ?? 0) + 1);
		const reply = await route(req, await readBody(req), { language, failures, chat, scenes }).catch(
			(err: unknown): Reply => ({
				status: 500,
				body: { error: { message: String(err) } }
			})
		);
		res.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify(reply.body));
	});
	await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
	return {
		setFailures: (next) => {
			failures = next.map((rule) => ({ ...rule }));
		},
		setSceneContinuation: (mode) => {
			scenes.continuation = mode;
		},
		requestCount: (path) => requests.get(path) ?? 0,
		peakChatConcurrency: () => chat.peak,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			})
	};
}

interface RouteContext {
	language: string;
	failures: MockFailure[];
	chat: ChatStats;
	scenes: { continuation: SceneContinuation };
}

async function route(
	req: http.IncomingMessage,
	body: Buffer,
	{ language, failures, chat, scenes }: RouteContext
): Promise<Reply> {
	const forced = takeFailure(failures, req.url);
	if (forced !== undefined) {
		return { status: forced.status, body: { error: { message: "forced failure" } } };
	}
	if (req.method === "POST" && req.url === TRANSCRIPTIONS_PATH) {
		return { status: 200, body: await transcription(body, req.headers["content-type"] ?? "", language) };
	}
	if (req.method === "POST" && req.url === CHAT_PATH) {
		return { status: 200, body: await chatReply(body, chat, scenes.continuation) };
	}
	return { status: 404, body: { error: { message: `no mock for ${req.method} ${req.url}` } } };
}

async function chatReply(body: Buffer, chat: ChatStats, continuation: SceneContinuation) {
	chat.inFlight += 1;
	chat.peak = Math.max(chat.peak, chat.inFlight);
	try {
		await delay(CHAT_DELAY_MS);
		return chatCompletion(body, continuation);
	} finally {
		chat.inFlight -= 1;
	}
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

const TARGET_PATTERN = / to ([^.]+)\./;
const STILL_PATTERN = /^Still (\d+) at ([\d.]+)s$/;
const SCENE_STRIDE = 3;
const PERSON = {
	species: "human",
	genderPresentation: null,
	approximateAge: null,
	skinTone: "medium",
	skinUndertone: "warm",
	hairTexture: null,
	curlType: null,
	hairColor: null,
	hairLength: null,
	facialHair: null,
	visibleMakeup: null,
	mood: null
};

interface ChatMessage {
	role: string;
	content: string | { type: string; text?: string }[];
}

interface SchemaNode {
	properties?: Record<string, SchemaNode>;
	items?: SchemaNode;
}

interface ChatRequest {
	model: string;
	messages: ChatMessage[];
	response_format?: { json_schema?: { name: string; schema: SchemaNode } };
}

function chatCompletion(body: Buffer, continuation: SceneContinuation) {
	const request = JSON.parse(body.toString("utf8")) as ChatRequest;
	const user = request.messages.find((message) => message.role === "user");
	const schema = request.response_format?.json_schema;
	const content =
		schema?.name.startsWith("scene_") === true
			? JSON.stringify(sceneContent(schema.schema, user?.content ?? [], continuation))
			: translationContent(request, user);
	return {
		id: "chatcmpl-mock",
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: request.model,
		choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
		usage: {
			prompt_tokens: Math.ceil(JSON.stringify(user?.content ?? "").length / CHARS_PER_TOKEN),
			completion_tokens: Math.ceil(content.length / CHARS_PER_TOKEN),
			total_tokens: Math.ceil((JSON.stringify(user?.content ?? "").length + content.length) / CHARS_PER_TOKEN)
		}
	};
}

function translationContent(request: ChatRequest, user: ChatMessage | undefined): string {
	const system = request.messages.find((message) => message.role === "system");
	const target = TARGET_PATTERN.exec(typeof system?.content === "string" ? system.content : "")?.[1];
	if (user === undefined || typeof user.content !== "string" || target === undefined) {
		throw new Error("chat request has no user message or target language");
	}
	const prefix = languageCode(target).toUpperCase();
	const { segments } = JSON.parse(user.content) as { segments: { index: number; text: string }[] };
	return JSON.stringify({
		segments: segments.map((segment) => ({ index: segment.index, text: `${prefix}: ${segment.text}` }))
	});
}

function sceneContent(
	schema: SchemaNode,
	user: ChatMessage["content"],
	continuation: SceneContinuation
): Record<string, unknown> {
	const properties = schema.properties ?? {};
	const withPeople = hasPeople(properties.scenes?.items) || hasPeople(properties.summary);
	return {
		...("summary" in properties && { summary: summaryContent(withPeople) }),
		...("scenes" in properties && { scenes: windowScenes(stillsIn(user), withPeople, continuation) })
	};
}

function hasPeople(node: SchemaNode | undefined): boolean {
	return node?.properties !== undefined && "people" in node.properties;
}

function stillsIn(user: ChatMessage["content"]): { index: number; timestampSec: number }[] {
	if (typeof user === "string") {
		return [];
	}
	return user.flatMap((part) => {
		const match = STILL_PATTERN.exec(part.text ?? "");
		return match === null ? [] : [{ index: Number(match[1]), timestampSec: Number(match[2]) }];
	});
}

function windowScenes(
	stills: { index: number; timestampSec: number }[],
	withPeople: boolean,
	continuation: SceneContinuation
) {
	return stills
		.filter((_, position) => position % SCENE_STRIDE === 0)
		.map((still, position) => ({
			startSec: still.timestampSec,
			reasonForTransition: "mock boundary",
			transcriptExcerpt: null,
			description: `Mock scene from still ${still.index}`,
			setting: "mock setting",
			products: position % 2 === 0 ? [{ type: "brand", name: "Acme" }] : [],
			...(withPeople && { people: [PERSON] }),
			representativeStillIndex: still.index,
			continuesPrevious: continuesAt(position, stills, continuation)
		}));
}

function continuesAt(position: number, stills: { index: number }[], continuation: SceneContinuation): boolean {
	if (continuation === "mid-window") {
		return position === 1;
	}
	return position === 0 && (stills[0]?.index ?? 0) > 0;
}

function summaryContent(withPeople: boolean) {
	return {
		title: "Mock title",
		description: "Mock description",
		setting: "mock setting",
		products: [{ type: "brand", name: "Acme" }],
		...(withPeople && { people: [PERSON] }),
		moods: ["calm"],
		tags: ["mock"]
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
