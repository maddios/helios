import { config } from "../config";

const DEMUXERS = [
	"mov",
	"mp4",
	"m4a",
	"3gp",
	"3g2",
	"mj2",
	"matroska",
	"webm",
	"avi",
	"mpegts",
	"flv",
	"mpeg",
	"ogg",
	"wav",
	"mp3",
	"aac",
	"flac",
	"image2",
	"png_pipe",
	"jpeg_pipe",
	"webp_pipe",
	"gif"
];

export function mediaInputGuardArgs(): string[] {
	const protocols = ["https", "tls", "tcp", ...(config().STAGE === "local" ? ["http"] : [])];
	return ["-protocol_whitelist", protocols.join(","), "-format_whitelist", DEMUXERS.join(",")];
}
