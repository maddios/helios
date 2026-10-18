import { execFileSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import type { VideoSourceMetadata } from "@helios/contracts";
import { FIXTURE_DIR, FIXTURE_FPS, VIDEO_FIXTURES, type VideoFixture } from "../../../local/fixtures";
import { config } from "../../src/config";

export interface FfprobeStream {
	codec_type: string;
	codec_name: string;
	sample_rate?: string;
	channels?: number;
}

export function fixturePath(name: string): string {
	return path.join(FIXTURE_DIR, name);
}

export function fixtureNamed(name: string): VideoFixture {
	const fixture = VIDEO_FIXTURES.find((candidate) => candidate.name === name);
	if (!fixture) {
		throw new Error(`unknown fixture ${name}`);
	}
	return fixture;
}

export function sourceFor(fixture: VideoFixture): VideoSourceMetadata {
	return {
		type: "video",
		sizeBytes: fs.statSync(fixturePath(fixture.name)).size,
		width: fixture.width,
		height: fixture.height,
		durationSec: fixture.durationSec,
		fps: FIXTURE_FPS,
		videoCodec: "h264",
		audioCodec: fixture.hasAudio ? "aac" : undefined,
		hasAudio: fixture.hasAudio
	};
}

export function makeWorkDir(): string {
	fs.mkdirSync(config().WORK_DIR, { recursive: true });
	return fs.mkdtempSync(path.join(config().WORK_DIR, "golden-"));
}

export function ffprobeStreams(file: string): FfprobeStream[] {
	const stdout = execFileSync(config().FFPROBE_PATH, ["-v", "error", "-print_format", "json", "-show_streams", file], {
		encoding: "utf8"
	});
	return (JSON.parse(stdout) as { streams: FfprobeStream[] }).streams;
}

export function topLevelBoxes(file: string): string[] {
	const data = fs.readFileSync(file);
	const boxes: string[] = [];
	let offset = 0;
	while (offset + 8 <= data.length) {
		let size = data.readUInt32BE(offset);
		if (size === 1) {
			size = Number(data.readBigUInt64BE(offset + 8));
		} else if (size === 0) {
			size = data.length - offset;
		}
		boxes.push(data.toString("latin1", offset + 4, offset + 8));
		offset += size;
	}
	return boxes;
}

export function expectWithin(actual: number | undefined, target: number, tolerance: number): void {
	expect(actual).toBeGreaterThanOrEqual(target * (1 - tolerance));
	expect(actual).toBeLessThanOrEqual(target * (1 + tolerance));
}

export interface FixtureServer {
	urlOf(name: string): string;
	close(): Promise<void>;
}

export async function serveFixtures(): Promise<FixtureServer> {
	const server = http.createServer((req, res) => {
		const file = fixturePath(path.posix.basename(decodeURIComponent(req.url ?? "")));
		if (!fs.existsSync(file)) {
			res.writeHead(404).end();
			return;
		}
		const size = fs.statSync(file).size;
		const [start, end] = byteRange(req.headers.range, size);
		res.writeHead(start === 0 && end === size - 1 ? 200 : 206, {
			"accept-ranges": "bytes",
			"content-length": end - start + 1,
			"content-range": `bytes ${start}-${end}/${size}`
		});
		fs.createReadStream(file, { start, end }).pipe(res);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const { port } = server.address() as AddressInfo;
	return {
		urlOf: (name) => `http://127.0.0.1:${port}/${encodeURIComponent(name)}`,
		close: () =>
			new Promise<void>((done) => {
				server.closeAllConnections();
				server.close(() => done());
			})
	};
}

function byteRange(header: string | undefined, size: number): [number, number] {
	const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
	if (match === null || (match[1] === "" && match[2] === "")) {
		return [0, size - 1];
	}
	if (match[1] === "") {
		return [Math.max(0, size - Number(match[2])), size - 1];
	}
	return [Number(match[1]), match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1)];
}
