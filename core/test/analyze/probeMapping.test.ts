import { UnprocessableSourceError } from "../../src/ssrf";
import { mapProbeOutput } from "../../src/analyze/probeMapping";

const format = (overrides: Record<string, unknown> = {}) => ({
	format_name: "mov,mp4,m4a,3gp,3g2,mj2",
	duration: "12.500000",
	size: "1048576",
	...overrides
});

const videoStream = (overrides: Record<string, unknown> = {}) => ({
	index: 0,
	codec_type: "video",
	codec_name: "h264",
	width: 1920,
	height: 1080,
	avg_frame_rate: "25/1",
	...overrides
});

const audioStream = { index: 1, codec_type: "audio", codec_name: "aac" };

describe("mapProbeOutput", () => {
	it("drops format.filename from the stored probe JSON", () => {
		const signed = "https://bucket.example/source.mp4?X-Amz-Signature=secret";
		const result = mapProbeOutput({ streams: [videoStream(), audioStream], format: format({ filename: signed }) });
		expect(JSON.stringify(result)).not.toContain("X-Amz-Signature");
	});

	it("maps a 1080p 16:9 video with audio", () => {
		expect(mapProbeOutput({ streams: [videoStream(), audioStream], format: format() })).toMatchObject({
			type: "video",
			sizeBytes: 1048576,
			width: 1920,
			height: 1080,
			durationSec: 12.5,
			fps: 25,
			videoCodec: "h264",
			audioCodec: "aac",
			hasAudio: true
		});
	});

	it("swaps dimensions for display matrix rotation of -90", () => {
		const stream = videoStream({ width: 1280, height: 720, side_data_list: [{ rotation: -90 }] });
		expect(mapProbeOutput({ streams: [stream], format: format() })).toMatchObject({ width: 720, height: 1280 });
	});

	it("swaps dimensions for a tags.rotate of 90", () => {
		const stream = videoStream({ width: 1280, height: 720, tags: { rotate: "90" } });
		expect(mapProbeOutput({ streams: [stream], format: format() })).toMatchObject({ width: 720, height: 1280 });
	});

	it("reads an average frame rate of 30000/1001 as about 29.97", () => {
		const stream = videoStream({ avg_frame_rate: "30000/1001" });
		const metadata = mapProbeOutput({ streams: [stream], format: format() });
		expect(metadata).toMatchObject({ type: "video" });
		expect((metadata as { fps: number }).fps).toBeCloseTo(29.97, 2);
	});

	it("maps a single-frame png as an image", () => {
		const stream = videoStream({ codec_name: "png", avg_frame_rate: "0/0" });
		const metadata = mapProbeOutput({
			streams: [stream],
			format: format({ format_name: "png_pipe", duration: "0.040000" })
		});
		expect(metadata).toMatchObject({ type: "image", width: 1920, height: 1080, hasAudio: false });
	});

	it("maps a video without audio as hasAudio false", () => {
		expect(mapProbeOutput({ streams: [videoStream()], format: format() })).toMatchObject({
			type: "video",
			hasAudio: false
		});
	});

	it("rejects a text file with no streams", () => {
		expect(() => mapProbeOutput({ streams: [], format: format({ format_name: "tty", duration: undefined }) })).toThrow(
			UnprocessableSourceError
		);
	});

	it("rejects a video with no duration", () => {
		expect(() => mapProbeOutput({ streams: [videoStream()], format: format({ duration: undefined }) })).toThrow(
			UnprocessableSourceError
		);
	});

	it("rejects a source without a format size", () => {
		expect(() => mapProbeOutput({ streams: [videoStream()], format: format({ size: undefined }) })).toThrow(
			UnprocessableSourceError
		);
	});
});
