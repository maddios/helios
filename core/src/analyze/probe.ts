import { spawn } from "node:child_process";
import type { SourceMetadata } from "@helios/contracts";
import { UnprocessableSourceError } from "../ssrf";
import { analyzeConfig } from "./config";
import { mediaInputGuardArgs } from "./inputGuard";
import { mapProbeOutput } from "./probeMapping";

const MS_PER_SEC = 1000;
const STDERR_TAIL_CHARS = 500;

export async function probeSource(url: string): Promise<SourceMetadata> {
	const { FFPROBE_PATH, ANALYZE_TIMEOUT_SEC } = analyzeConfig();
	const stdout = await runFfprobe(FFPROBE_PATH, url, ANALYZE_TIMEOUT_SEC);
	return mapProbeOutput(parseJson(stdout));
}

function runFfprobe(binary: string, url: string, timeoutSec: number): Promise<string> {
	const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", ...mediaInputGuardArgs(), url];
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			stderr += chunk;
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new UnprocessableSourceError(`ffprobe timed out after ${timeoutSec} seconds`));
		}, timeoutSec * MS_PER_SEC);
		child.once("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(
					new UnprocessableSourceError(
						`ffprobe exited with code ${code}: ${redact(stderr.trim(), url).slice(-STDERR_TAIL_CHARS)}`
					)
				);
			}
		});
	});
}

function redact(text: string, url: string): string {
	return text.replaceAll(url, "<source>");
}

function parseJson(stdout: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		throw new UnprocessableSourceError("ffprobe output is not JSON");
	}
}
