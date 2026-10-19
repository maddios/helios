import { inputArgs } from "../../../src/ffmpeg/args";
import { audioExtractArgs } from "../../../src/transcribe/extractAudio";
import { cutChunkArgs } from "../../../src/transcribe/cutChunk";

const SOURCE = "https://bucket.test.invalid/source.mp4";

describe("audioExtractArgs", () => {
	it("builds the guarded mono 16 kHz mp3 extraction", () => {
		expect(audioExtractArgs(SOURCE, "/work/audio.mp3")).toEqual([
			...inputArgs(SOURCE),
			"-vn",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-c:a",
			"libmp3lame",
			"-b:a",
			"32k",
			"-f",
			"mp3",
			"/work/audio.mp3"
		]);
	});

	it("applies the input guard before the input", () => {
		const args = audioExtractArgs(SOURCE, "/work/audio.mp3");

		expect(args.slice(args.indexOf("-i"), args.indexOf("-i") + 2)).toEqual(["-i", SOURCE]);
		expect(args).toEqual(expect.arrayContaining(["-protocol_whitelist", "-format_whitelist"]));
	});
});

describe("cutChunkArgs", () => {
	it("seeks and limits the window and stream-copies the mp3", () => {
		const chunk = { index: 1, start: 55, end: 125, keepFrom: 60, keepUntil: 120 };

		expect(cutChunkArgs("/work/audio.mp3", chunk, "/work/chunk-1.mp3")).toEqual([
			"-y",
			"-nostdin",
			"-ss",
			"55",
			"-t",
			"70",
			"-i",
			"/work/audio.mp3",
			"-map",
			"0:a:0",
			"-c",
			"copy",
			"-f",
			"mp3",
			"/work/chunk-1.mp3"
		]);
	});
});
