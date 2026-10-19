import fs from "node:fs";
import path from "node:path";
import { planChunks } from "../../src/transcribe/planChunks";
import { cutChunk } from "../../src/transcribe/cutChunk";
import { extractAudio } from "../../src/transcribe/extractAudio";
import { probeOutput } from "../../src/ffmpeg/probe";
import { ffprobeStreams, expectWithin, makeWorkDir, serveFixtures, type FixtureServer } from "./support";

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

describe("extractAudio on a 1080p source", () => {
	it("produces mono 16 kHz mp3 at about 32 kbps with the source duration", async () => {
		const out = path.join(workDir, "h1080-audio.mp3");

		await extractAudio(fixtures.urlOf("h1080_16x9.mp4"), out, new AbortController().signal);

		const [stream] = ffprobeStreams(out);
		expect(stream).toMatchObject({ codec_name: "mp3", channels: 1, sample_rate: "16000" });
		const probe = await probeOutput(out);
		expectWithin(probe.bitrateK, 32, 0.15);
		expectWithin(probe.durationSec, 12, 0.02);
	});
});

describe("chunk cutting on a 200 s source", () => {
	it("cuts windows whose durations match their planned bounds", async () => {
		const audio = path.join(workDir, "long-audio.mp3");
		const signal = new AbortController().signal;
		await extractAudio(fixtures.urlOf("long_1080.mp4"), audio, signal);
		const { durationSec } = await probeOutput(audio);
		const plans = planChunks(durationSec ?? 0, fs.statSync(audio).size, {
			maxUploadBytes: 100_000,
			chunkSec: 60,
			overlapSec: 5
		});

		expect(plans.map(({ keepFrom, keepUntil }) => [keepFrom, keepUntil])).toEqual([
			[0, 60],
			[60, 120],
			[120, 180],
			[180, Infinity]
		]);
		expect(plans.map((plan) => plan.start)).toEqual([0, 55, 115, 175]);
		expectWithin(plans[plans.length - 1].end, durationSec ?? 0, 0.001);
		for (const plan of plans) {
			const out = path.join(workDir, `long-chunk-${plan.index}.mp3`);
			await cutChunk(audio, plan, out, signal);
			const cut = await probeOutput(out);
			expect(Math.abs((cut.durationSec ?? 0) - (plan.end - plan.start))).toBeLessThan(0.15);
		}
	});
});
