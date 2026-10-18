import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeConfig, probeSource, resetAnalyzeConfigForTests } from "../../src/analyze";
import { UnprocessableSourceError } from "../../src/ssrf";

process.env.ANALYZE_TIMEOUT_SEC = "10";
process.env.SOURCE_URL_TTL_SEC = "3600";
process.env.MAX_INGEST_BYTES = "524288000";

const SOURCE_URL = "https://example.test/source.mp4";
const CANNED_PROBE = {
	streams: [
		{ index: 0, codec_type: "video", codec_name: "h264", width: 640, height: 360, avg_frame_rate: "24/1" },
		{ index: 1, codec_type: "audio", codec_name: "aac" }
	],
	format: { format_name: "mov,mp4", duration: "3.000000", size: "2048" }
};

let workDir: string;

async function writeFakeFfprobe(body: string): Promise<string> {
	const script = path.join(workDir, "ffprobe");
	await writeFile(script, `#!${process.execPath}\n${body}\n`);
	await chmod(script, 0o755);
	return script;
}

function useFfprobe(binary: string, timeoutSec: number): void {
	process.env.FFPROBE_PATH = binary;
	process.env.ANALYZE_TIMEOUT_SEC = String(timeoutSec);
	resetAnalyzeConfigForTests();
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitUntilExited(pid: number): Promise<boolean> {
	for (let attempt = 0; attempt < 50; attempt++) {
		if (!isRunning(pid)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return false;
}

describe("probeSource", () => {
	beforeEach(async () => {
		workDir = await mkdtemp(path.join(os.tmpdir(), "probe-test-"));
	});

	afterEach(async () => {
		await rm(workDir, { recursive: true, force: true });
	});

	it("maps the JSON printed by ffprobe for the source url", async () => {
		const argsFile = path.join(workDir, "args.json");
		const binary = await writeFakeFfprobe(
			`require("fs").writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));` +
				`process.stdout.write(${JSON.stringify(JSON.stringify(CANNED_PROBE))});`
		);
		useFfprobe(binary, 10);

		await expect(probeSource(SOURCE_URL)).resolves.toMatchObject({ type: "video", width: 640, height: 360 });
		expect(JSON.parse(await readFile(argsFile, "utf8"))).toEqual([
			"-v",
			"error",
			"-print_format",
			"json",
			"-show_format",
			"-show_streams",
			"-protocol_whitelist",
			"https,tls,tcp,http",
			"-format_whitelist",
			"mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts,flv,mpeg,ogg,wav,mp3,aac,flac,image2,png_pipe,jpeg_pipe,webp_pipe,gif",
			SOURCE_URL
		]);
	});

	it("rejects with UnprocessableSourceError when ffprobe exits non-zero", async () => {
		useFfprobe(await writeFakeFfprobe("process.exit(1);"), 10);

		await expect(probeSource(SOURCE_URL)).rejects.toThrow(UnprocessableSourceError);
	});

	it("kills a hung ffprobe on timeout and rejects with a timeout error", async () => {
		const pidFile = path.join(workDir, "pid");
		const binary = await writeFakeFfprobe(
			`require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));` + "setInterval(() => {}, 1000);"
		);
		useFfprobe(binary, 1);

		const error = await probeSource(SOURCE_URL).catch((err: unknown) => err);

		expect(error).toBeInstanceOf(UnprocessableSourceError);
		expect((error as Error).message).toContain("timed out");
		const pid = Number(await readFile(pidFile, "utf8"));
		expect(await waitUntilExited(pid)).toBe(true);
	});

	it("throws when a required analyze setting is missing", () => {
		const previous = process.env.FFPROBE_PATH;
		delete process.env.FFPROBE_PATH;
		resetAnalyzeConfigForTests();
		try {
			expect(() => analyzeConfig()).toThrow("FFPROBE_PATH");
		} finally {
			process.env.FFPROBE_PATH = previous;
			resetAnalyzeConfigForTests();
		}
	});
});
