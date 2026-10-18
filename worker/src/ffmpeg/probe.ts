import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config";

const execFileAsync = promisify(execFile);

interface ProbeStream {
	codec_type?: string;
	codec_name?: string;
	width?: number;
	height?: number;
	bit_rate?: string;
}

interface ProbeOutput {
	format: { duration?: string };
	streams: ProbeStream[];
}

export interface OutputProbe {
	width?: number;
	height?: number;
	durationSec?: number;
	bitrateK?: number;
	codec?: string;
}

export async function probeOutput(path: string): Promise<OutputProbe> {
	const { stdout } = await execFileAsync(
		config().FFPROBE_PATH,
		["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
		{ maxBuffer: 16 * 1024 * 1024 }
	);
	const probe = JSON.parse(stdout) as ProbeOutput;
	const stream =
		probe.streams.find((candidate) => candidate.codec_type === "video") ??
		probe.streams.find((candidate) => candidate.codec_type === "audio");
	const { duration } = probe.format;
	return {
		width: stream?.width,
		height: stream?.height,
		durationSec: duration === undefined ? undefined : Number(duration),
		bitrateK: stream?.bit_rate === undefined ? undefined : Math.round(Number(stream.bit_rate) / 1000),
		codec: stream?.codec_name
	};
}
