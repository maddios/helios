import fs from "node:fs";
import path from "node:path";
import { genericPreset } from "@helios/core";
import type { AudioProfile, EncodingProfile, StillsProfile, VideoProfile } from "@helios/contracts";
import { buildCommand, stillTimestamps } from "../../src/ffmpeg/args";
import { probeOutput } from "../../src/ffmpeg/probe";
import { runFfmpeg } from "../../src/ffmpeg/run";
import { convertImage } from "../../src/image/convert";
import { IMAGE_FIXTURE } from "../../../local/fixtures";
import {
	expectWithin,
	ffprobeStreams,
	fixtureNamed,
	fixturePath,
	makeWorkDir,
	serveFixtures,
	type FixtureServer,
	sourceFor,
	topLevelBoxes
} from "./support";

function profile<T extends EncodingProfile>(name: string): T {
	const found = genericPreset.profiles.find((candidate) => candidate.name === name);
	if (!found) {
		throw new Error(`missing profile ${name}`);
	}
	return found as T;
}

const mp4360 = profile<VideoProfile>("mp4_360");
const mp4720 = profile<VideoProfile>("mp4_720");
const mp4_1080 = profile<VideoProfile>("mp4_1080");
const stills = profile<StillsProfile>("stills");
const mp3 = profile<AudioProfile>("audio");

let workDir: string;
let fixtures: FixtureServer;

beforeAll(async () => {
	workDir = makeWorkDir();
	fixtures = await serveFixtures();
});

afterAll(async () => {
	fs.rmSync(workDir, { recursive: true, force: true });
	await fixtures.close();
});

async function encodeVideo(fixtureName: string, video: VideoProfile, outName: string): Promise<string> {
	const fixture = fixtureNamed(fixtureName);
	const out = path.join(workDir, outName);
	await runFfmpeg(
		buildCommand(fixtures.urlOf(fixture.name), [
			{ type: "video", profile: video, source: sourceFor(fixture), outPath: out }
		]),
		{
			durationSec: fixture.durationSec
		}
	);
	return out;
}

describe("mp4_360 with stills in one invocation on 1080p", () => {
	it("produces 360p video, faststart, aac audio and stills", async () => {
		const fixture = fixtureNamed("h1080_16x9.mp4");
		const out = path.join(workDir, "combined.mp4");
		const tmb = path.join(workDir, "tmb");
		fs.mkdirSync(tmb);

		await runFfmpeg(
			buildCommand(fixtures.urlOf(fixture.name), [
				{ type: "video", profile: mp4360, source: sourceFor(fixture), outPath: out },
				{ type: "stills", profile: stills, outPath: path.join(tmb, "%04d.jpg") }
			]),
			{ durationSec: fixture.durationSec }
		);

		const probe = await probeOutput(out);
		expect(probe.height).toBe(360);
		expect(probe.width).toBe(640);
		expectWithin(probe.bitrateK, 800, 0.25);

		const boxes = topLevelBoxes(out);
		expect(boxes.indexOf("moov")).toBeLessThan(boxes.indexOf("mdat"));

		const audio = ffprobeStreams(out).find((stream) => stream.codec_type === "audio");
		expect(audio).toMatchObject({ codec_name: "aac", sample_rate: "44100", channels: 2 });

		const files = fs.readdirSync(tmb).sort();
		expect(Math.abs(files.length - Math.ceil(fixture.durationSec / 3))).toBeLessThanOrEqual(1);
		expect(files[0]).toBe("0001.jpg");
		expect(stillTimestamps("1/3", files.length)).toEqual(files.map((_, index) => index * 3));
		expect((await probeOutput(path.join(tmb, files[0]))).width).toBe(1920);
	});
});

describe("video profiles", () => {
	it("encodes mp4_720 at 720p", async () => {
		const probe = await probeOutput(await encodeVideo("h1080_16x9.mp4", mp4720, "720.mp4"));
		expect(probe.height).toBe(720);
		expect(probe.width).toBe(1280);
		expectWithin(probe.bitrateK, 1800, 0.25);
	});

	it("encodes mp4_1080 at 1080p", async () => {
		const probe = await probeOutput(await encodeVideo("h1080_16x9.mp4", mp4_1080, "1080.mp4"));
		expect(probe.height).toBe(1080);
		expect(probe.width).toBe(1920);
		expectWithin(probe.bitrateK, 2700, 0.25);
	});

	it("scales a 9:16 source to 360 high with an even width", async () => {
		const probe = await probeOutput(await encodeVideo("v720_9x16.mp4", mp4360, "portrait.mp4"));
		expect(probe.height).toBe(360);
		expect([202, 204]).toContain(probe.width);
	});

	it("keeps a 300p source at 300p", async () => {
		const probe = await probeOutput(await encodeVideo("h300.mp4", mp4360, "h300.mp4"));
		expect(probe.height).toBe(300);
		expect(probe.width).toBe(534);
	});

	it("writes no audio stream for a silent source", async () => {
		const out = await encodeVideo("noaudio_720.mp4", mp4360, "silent.mp4");
		const streams = ffprobeStreams(out);
		expect(streams.map((stream) => stream.codec_type)).toEqual(["video"]);
	});
});

describe("audio and image outputs", () => {
	it("encodes mp3 at 44100 Hz stereo around 92 kbps", async () => {
		const fixture = fixtureNamed("h1080_16x9.mp4");
		const out = path.join(workDir, "audio.mp3");
		await runFfmpeg(buildCommand(fixtures.urlOf(fixture.name), [{ type: "audio", profile: mp3, outPath: out }]), {
			durationSec: fixture.durationSec
		});
		expect(ffprobeStreams(out)[0]).toMatchObject({ codec_name: "mp3", sample_rate: "44100", channels: 2 });
		expectWithin((await probeOutput(out)).bitrateK, 92, 0.1);
	});

	it("converts the image to jpg and copies one still at source resolution", async () => {
		const input = fixturePath(IMAGE_FIXTURE.name);
		const jpg = path.join(workDir, "image.jpg");
		const still = path.join(workDir, "still.jpg");

		await convertImage(input, jpg, { format: "jpg", quality: 90 });
		await convertImage(input, still, { format: "jpg", quality: 90 });

		expect(await probeOutput(jpg)).toMatchObject({ width: IMAGE_FIXTURE.width, height: IMAGE_FIXTURE.height });
		expect(await probeOutput(still)).toMatchObject({ width: IMAGE_FIXTURE.width, height: IMAGE_FIXTURE.height });
		expect(fs.readFileSync(jpg).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
		expect(fs.readFileSync(still).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
	});
});
