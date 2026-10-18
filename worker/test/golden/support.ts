import { execFileSync } from "node:child_process";
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
