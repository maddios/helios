import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

export const FIXTURE_DIR = path.join(ROOT, ".cache", "fixtures");
export const FIXTURE_FPS = 30;

export interface VideoFixture {
	name: string;
	width: number;
	height: number;
	durationSec: number;
	hasAudio: boolean;
}

export const VIDEO_FIXTURES: VideoFixture[] = [
	{ name: "h1080_16x9.mp4", width: 1920, height: 1080, durationSec: 12, hasAudio: true },
	{ name: "v720_9x16.mp4", width: 720, height: 1280, durationSec: 10, hasAudio: true },
	{ name: "h300.mp4", width: 534, height: 300, durationSec: 9, hasAudio: true },
	{ name: "noaudio_720.mp4", width: 1280, height: 720, durationSec: 6, hasAudio: false },
	{ name: "long_1080.mp4", width: 1920, height: 1080, durationSec: 200, hasAudio: true }
];

export const IMAGE_FIXTURE = { name: "image.png", width: 1600, height: 900 };

function videoArgs(fixture: VideoFixture, out: string): string[] {
	const { width, height, durationSec, hasAudio } = fixture;
	const audio = hasAudio
		? ["-f", "lavfi", "-i", `sine=frequency=1000:duration=${durationSec}`, "-c:a", "aac", "-b:a", "128k"]
		: [];
	return [
		"-f",
		"lavfi",
		"-i",
		`testsrc2=size=${width}x${height}:rate=${FIXTURE_FPS}:duration=${durationSec}`,
		...audio,
		"-c:v",
		"libx264",
		"-preset",
		"ultrafast",
		"-pix_fmt",
		"yuv420p",
		out
	];
}

function imageArgs(out: string): string[] {
	const { width, height } = IMAGE_FIXTURE;
	return ["-f", "lavfi", "-i", `testsrc2=size=${width}x${height}`, "-frames:v", "1", out];
}

function generateMissing(name: string, args: (out: string) => string[]): void {
	const out = path.join(FIXTURE_DIR, name);
	if (fs.existsSync(out)) {
		console.log(`skip ${name} (exists)`);
		return;
	}
	const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args(out)], { stdio: "inherit" });
	if (result.status !== 0) {
		throw new Error(`ffmpeg failed generating ${name}`);
	}
	console.log(`wrote ${name}`);
}

export function generateFixtures(): void {
	fs.mkdirSync(FIXTURE_DIR, { recursive: true });
	for (const fixture of VIDEO_FIXTURES) {
		generateMissing(fixture.name, (out) => videoArgs(fixture, out));
	}
	generateMissing(IMAGE_FIXTURE.name, imageArgs);
}

if (require.main === module) {
	generateFixtures();
}
