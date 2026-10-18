import type { AudioProfile, StillsProfile, VideoProfile, VideoSourceMetadata } from "@helios/contracts";

const RECONNECT_ARGS = [
	"-reconnect_on_http_error",
	"503,500",
	"-reconnect_streamed",
	"1",
	"-reconnect_delay_max",
	"2",
	"-reconnect_on_network_error",
	"1"
];

export function inputArgs(input: string): string[] {
	const isHttp = /^https?:\/\//i.test(input);
	return ["-y", "-nostdin", ...(isHttp ? RECONNECT_ARGS : []), "-progress", "pipe:1", "-nostats", "-i", input];
}

export function videoOutputArgs(profile: VideoProfile, source: VideoSourceMetadata, outPath: string): string[] {
	const { params } = profile;
	const height = Math.min(params.height, source.height);
	const evenHeight = height - (height % 2);
	const filters = [...(params.deinterlace ? ["yadif=0:-1:0"] : []), `scale=-2:${evenHeight}`].join(",");
	const bitrate = `${params.videoBitrateK}k`;
	const rateArgs = params.rateControl === "cbr" ? ["-maxrate:v", bitrate, "-bufsize:v", bitrate] : [];
	const audioMap = source.hasAudio ? ["-map", "0:a:0"] : [];
	const audioArgs = source.hasAudio
		? ["-c:a", "aac", "-ac", "2", "-ar", String(params.audioSampleRate), "-b:a", `${params.audioBitrateK}k`]
		: [];
	return [
		"-map",
		"0:v:0",
		...audioMap,
		"-vf",
		filters,
		"-c:v",
		"libx264",
		"-preset:v",
		params.x264Preset,
		"-profile:v",
		params.x264Profile,
		"-x264opts",
		params.x264Opts,
		"-b:v",
		bitrate,
		...rateArgs,
		"-r",
		String(params.fps),
		"-g",
		String(Math.round(params.fps * params.gopSeconds)),
		"-pix_fmt",
		"yuv420p",
		...audioArgs,
		...(params.faststart ? ["-movflags", "+faststart"] : []),
		"-dn",
		"-f",
		"mp4",
		outPath
	];
}

export function stillsOutputArgs(profile: StillsProfile, outPattern: string): string[] {
	const { fps, maxCount } = profile.params;
	return [
		"-map",
		"0:v:0",
		"-vf",
		`fps=${fps}`,
		"-pix_fmt",
		"yuvj420p",
		...(maxCount === undefined ? [] : ["-frames:v", String(maxCount)]),
		"-f",
		"image2",
		outPattern
	];
}

export function audioOutputArgs(profile: AudioProfile, outPath: string): string[] {
	const { bitrateK, sampleRate } = profile.params;
	return [
		"-map",
		"0:a:0",
		"-vn",
		"-c:a",
		"libmp3lame",
		"-ac",
		"2",
		"-ar",
		String(sampleRate),
		"-b:a",
		`${bitrateK}k`,
		"-f",
		"mp3",
		outPath
	];
}

export function stillTimestamps(fps: string, count: number): number[] {
	const [numerator, denominator = "1"] = fps.split("/");
	const rate = Number(numerator) / Number(denominator);
	return Array.from({ length: count }, (_, index) => index / rate);
}

type OutputSpecs = {
	video: { profile: VideoProfile; source: VideoSourceMetadata; outPath: string };
	stills: { profile: StillsProfile; outPath: string };
	audio: { profile: AudioProfile; outPath: string };
};

type ProfileKind = keyof OutputSpecs;

export type FfmpegOutput = { [K in ProfileKind]: { type: K } & OutputSpecs[K] }[ProfileKind];

const outputBuilders: { [K in ProfileKind]: (output: OutputSpecs[K]) => string[] } = {
	video: ({ profile, source, outPath }) => videoOutputArgs(profile, source, outPath),
	stills: ({ profile, outPath }) => stillsOutputArgs(profile, outPath),
	audio: ({ profile, outPath }) => audioOutputArgs(profile, outPath)
};

export function outputArgs<K extends ProfileKind>(type: K, output: OutputSpecs[K]): string[] {
	return outputBuilders[type](output);
}

export function buildCommand(input: string, outputs: FfmpegOutput[]): string[] {
	return [...inputArgs(input), ...outputs.flatMap((output) => outputArgs(output.type, output))];
}
