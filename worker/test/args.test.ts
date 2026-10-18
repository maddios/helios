import { genericPreset } from "@helios/core";
import type {
	AudioProfile,
	EncodingProfile,
	StillsProfile,
	VideoProfile,
	VideoSourceMetadata
} from "@helios/contracts";
import {
	buildCommand,
	inputArgs,
	stillTimestamps,
	stillsOutputArgs,
	audioOutputArgs,
	videoOutputArgs
} from "../src/ffmpeg/args";
import { parseProgress } from "../src/ffmpeg/run";

function profile<T extends EncodingProfile>(name: string): T {
	const found = genericPreset.profiles.find((candidate) => candidate.name === name);
	if (!found) {
		throw new Error(`missing profile ${name}`);
	}
	return found as T;
}

const HTTP_URL = "https://bucket.example/source.mp4?X-Amz-Signature=abc";

const source1080: VideoSourceMetadata = {
	type: "video",
	sizeBytes: 1000,
	width: 1920,
	height: 1080,
	durationSec: 12,
	fps: 30,
	videoCodec: "h264",
	audioCodec: "aac",
	hasAudio: true
};

const source300: VideoSourceMetadata = { ...source1080, width: 534, height: 300 };
const sourceNoAudio: VideoSourceMetadata = { ...source1080, audioCodec: undefined, hasAudio: false };

const mp4360 = profile<VideoProfile>("mp4_360");
const stills = profile<StillsProfile>("stills");
const mp3 = profile<AudioProfile>("audio");

const RECONNECT = [
	"-reconnect_on_http_error",
	"503,500",
	"-reconnect_streamed",
	"1",
	"-reconnect_delay_max",
	"2",
	"-reconnect_on_network_error",
	"1"
];

describe("inputArgs", () => {
	it("adds reconnect flags for http(s) inputs", () => {
		expect(inputArgs(HTTP_URL)).toEqual([
			"-y",
			"-nostdin",
			...RECONNECT,
			"-progress",
			"pipe:1",
			"-nostats",
			"-i",
			HTTP_URL
		]);
	});

	it("omits reconnect flags for local files", () => {
		expect(inputArgs("/tmp/source.mp4")).toEqual([
			"-y",
			"-nostdin",
			"-progress",
			"pipe:1",
			"-nostats",
			"-i",
			"/tmp/source.mp4"
		]);
	});
});

describe("videoOutputArgs", () => {
	it("encodes mp4_360 from a 1080p source with audio", () => {
		expect(videoOutputArgs(mp4360, source1080, "/out/a.mp4")).toEqual([
			"-map",
			"0:v:0",
			"-map",
			"0:a:0",
			"-vf",
			"yadif=0:-1:0,scale=-2:360",
			"-c:v",
			"libx264",
			"-preset:v",
			"faster",
			"-profile:v",
			"main",
			"-x264opts",
			"nr=500:ref=2",
			"-b:v",
			"800k",
			"-r",
			"30",
			"-g",
			"90",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-ac",
			"2",
			"-ar",
			"44100",
			"-b:a",
			"96k",
			"-movflags",
			"+faststart",
			"-dn",
			"-f",
			"mp4",
			"/out/a.mp4"
		]);
	});

	it("uses the mp4_720 and mp4_1080 heights and bitrates", () => {
		const mp4720 = videoOutputArgs(profile<VideoProfile>("mp4_720"), source1080, "/out/b.mp4");
		expect(mp4720).toEqual(
			expect.arrayContaining(["-vf", "yadif=0:-1:0,scale=-2:720", "-b:v", "1800k", "-b:a", "256k"])
		);
		const mp4_1080 = videoOutputArgs(profile<VideoProfile>("mp4_1080"), source1080, "/out/c.mp4");
		expect(mp4_1080).toEqual(expect.arrayContaining(["-vf", "yadif=0:-1:0,scale=-2:1080", "-b:v", "2700k"]));
	});

	it("never upscales a 300p source", () => {
		expect(videoOutputArgs(mp4360, source300, "/out/d.mp4")).toEqual(
			expect.arrayContaining(["-vf", "yadif=0:-1:0,scale=-2:300"])
		);
	});

	it("rounds an odd scaled height down to an even one and never upscales", () => {
		const source241: VideoSourceMetadata = { ...source1080, width: 428, height: 241 };
		const source607: VideoSourceMetadata = { ...source1080, width: 1080, height: 607 };
		expect(videoOutputArgs(mp4360, source241, "/out/g.mp4")).toEqual(
			expect.arrayContaining(["-vf", "yadif=0:-1:0,scale=-2:240"])
		);
		expect(videoOutputArgs(profile<VideoProfile>("mp4_720"), source607, "/out/h.mp4")).toEqual(
			expect.arrayContaining(["-vf", "yadif=0:-1:0,scale=-2:606"])
		);
	});

	it("drops the audio map and audio args for a source without audio", () => {
		const args = videoOutputArgs(mp4360, sourceNoAudio, "/out/e.mp4");
		expect(args).not.toContain("0:a:0");
		expect(args).not.toContain("-c:a");
		expect(args).not.toContain("-b:a");
		expect(args.slice(0, 2)).toEqual(["-map", "0:v:0"]);
	});

	it("adds maxrate and bufsize for cbr", () => {
		const cbr: VideoProfile = { ...mp4360, params: { ...mp4360.params, rateControl: "cbr" } };
		expect(videoOutputArgs(cbr, source1080, "/out/f.mp4")).toEqual(
			expect.arrayContaining(["-b:v", "800k", "-maxrate:v", "800k", "-bufsize:v", "800k"])
		);
	});
});

describe("stillsOutputArgs", () => {
	it("extracts stills at source resolution", () => {
		expect(stillsOutputArgs(stills, "/out/tmb/%04d.jpg")).toEqual([
			"-map",
			"0:v:0",
			"-vf",
			"fps=1/3",
			"-pix_fmt",
			"yuvj420p",
			"-f",
			"image2",
			"/out/tmb/%04d.jpg"
		]);
	});

	it("caps the count with -frames:v", () => {
		expect(stillsOutputArgs({ ...stills, params: { fps: "1", maxCount: 1 } }, "/out/tmb/%04d.jpg")).toEqual([
			"-map",
			"0:v:0",
			"-vf",
			"fps=1",
			"-pix_fmt",
			"yuvj420p",
			"-frames:v",
			"1",
			"-f",
			"image2",
			"/out/tmb/%04d.jpg"
		]);
	});
});

describe("audioOutputArgs", () => {
	it("encodes mp3 without video", () => {
		expect(audioOutputArgs(mp3, "/out/a.mp3")).toEqual([
			"-map",
			"0:a:0",
			"-vn",
			"-c:a",
			"libmp3lame",
			"-ac",
			"2",
			"-ar",
			"44100",
			"-b:a",
			"92k",
			"-f",
			"mp3",
			"/out/a.mp3"
		]);
	});
});

describe("buildCommand", () => {
	it("runs parent and child outputs in one invocation", () => {
		const command = buildCommand(HTTP_URL, [
			{ type: "video", profile: mp4360, source: source1080, outPath: "/out/a.mp4" },
			{ type: "stills", profile: stills, outPath: "/out/tmb/%04d.jpg" }
		]);
		expect(command).toEqual([
			...inputArgs(HTTP_URL),
			...videoOutputArgs(mp4360, source1080, "/out/a.mp4"),
			...stillsOutputArgs(stills, "/out/tmb/%04d.jpg")
		]);
	});
});

describe("stillTimestamps", () => {
	it("maps indexes to timestamps for fractional and whole rates", () => {
		expect(stillTimestamps("1/3", 4)).toEqual([0, 3, 6, 9]);
		expect(stillTimestamps("1", 3)).toEqual([0, 1, 2]);
	});
});

describe("parseProgress", () => {
	it("reads out_time_us in seconds", () => {
		expect(parseProgress("frame=10\nout_time_us=3000000\nprogress=continue")).toEqual({
			outTimeSec: 3,
			ended: false
		});
	});

	it("ignores out_time_ms, which ffmpeg reports in microseconds", () => {
		expect(parseProgress("out_time_ms=1500000")).toEqual({ outTimeSec: undefined, ended: false });
	});

	it("detects the end marker and ignores N/A times", () => {
		expect(parseProgress("out_time_us=N/A\nprogress=end")).toEqual({ outTimeSec: undefined, ended: true });
	});
});
