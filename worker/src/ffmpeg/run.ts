import { spawn } from "node:child_process";
import { config } from "../config";

const STDERR_TAIL_LINES = 50;

export class FfmpegError extends Error {
	readonly exitCode: number | null;
	readonly stderrTail: string;

	constructor(exitCode: number | null, stderrTail: string) {
		super(`ffmpeg exited with code ${exitCode}`);
		this.name = "FfmpegError";
		this.exitCode = exitCode;
		this.stderrTail = stderrTail;
	}
}

export interface ProgressUpdate {
	outTimeSec?: number;
	ended: boolean;
}

export function parseProgress(text: string): ProgressUpdate {
	const fields = new Map(
		text.split("\n").flatMap((line) => {
			const separator = line.indexOf("=");
			return separator < 0 ? [] : [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const];
		})
	);
	const outTimeUs = Number(fields.get("out_time_us"));
	return {
		outTimeSec: Number.isFinite(outTimeUs) ? outTimeUs / 1_000_000 : undefined,
		ended: fields.get("progress") === "end"
	};
}

export interface RunOptions {
	durationSec?: number;
	onProgress?: (pct: number) => void;
	signal?: AbortSignal;
}

function splitCompleteLines(pending: string, chunk: string): { lines: string[]; rest: string } {
	const parts = (pending + chunk).split(/\r\n|\r|\n/);
	return { lines: parts.slice(0, -1), rest: parts[parts.length - 1] };
}

export async function runFfmpeg(args: string[], { durationSec, onProgress, signal }: RunOptions = {}): Promise<void> {
	signal?.throwIfAborted();
	const child = spawn(config().FFMPEG_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
	const stderrLines: string[] = [];
	let pendingStdout = "";
	let pendingStderr = "";

	child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
		const { lines, rest } = splitCompleteLines(pendingStdout, chunk);
		pendingStdout = rest;
		const update = parseProgress(lines.join("\n"));
		if (!onProgress) {
			return;
		}
		if (update.ended) {
			onProgress(100);
		} else if (update.outTimeSec !== undefined && durationSec) {
			onProgress(Math.min(100, Math.floor((update.outTimeSec / durationSec) * 100)));
		}
	});
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
		const { lines, rest } = splitCompleteLines(pendingStderr, chunk);
		pendingStderr = rest;
		stderrLines.push(...lines.filter((line) => line.trim() !== ""));
		stderrLines.splice(0, Math.max(0, stderrLines.length - STDERR_TAIL_LINES));
	});

	const kill = () => child.kill("SIGKILL");
	signal?.addEventListener("abort", kill, { once: true });
	const detach = () => signal?.removeEventListener("abort", kill);

	return new Promise<void>((resolve, reject) => {
		child.once("error", (err) => {
			detach();
			reject(err);
		});
		child.once("close", (exitCode) => {
			detach();
			if (signal?.aborted) {
				reject(signal.reason);
				return;
			}
			if (exitCode === 0) {
				resolve();
				return;
			}
			const tail = [...stderrLines, pendingStderr].filter((line) => line.trim() !== "");
			reject(new FfmpegError(exitCode, tail.slice(-STDERR_TAIL_LINES).join("\n")));
		});
	});
}
