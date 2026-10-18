import type { Preset, VideoProfile } from "@helios/contracts";

const h264: VideoProfile["params"] = {
	codec: "h264",
	height: 360,
	videoBitrateK: 800,
	audioBitrateK: 96,
	audioSampleRate: 44100,
	rateControl: "vbr",
	x264Preset: "faster",
	x264Profile: "main",
	x264Opts: "nr=500:ref=2",
	deinterlace: true,
	fps: 30,
	gopSeconds: 3,
	faststart: true
};

export const genericPreset: Preset = {
	name: "generic",
	version: 1,
	description: "Generic MP4 renditions, stills, audio and image outputs",
	profiles: [
		{
			name: "mp4_360",
			version: 1,
			type: "video",
			priority: 10,
			isDefault: true,
			sourceTypes: ["video"],
			children: ["stills"],
			output: "{id}.mp4",
			params: h264
		},
		{
			name: "stills",
			version: 1,
			type: "stills",
			priority: 10,
			isDefault: false,
			sourceTypes: ["video"],
			children: [],
			output: "tmb/%04d.jpg",
			params: { fps: "1/3" }
		},
		{
			name: "audio",
			version: 1,
			type: "audio",
			priority: 40,
			isDefault: false,
			sourceTypes: ["video"],
			children: [],
			output: "{id}.mp3",
			params: { codec: "mp3", bitrateK: 92, sampleRate: 44100 }
		},
		{
			name: "mp4_720",
			version: 1,
			type: "video",
			priority: 100,
			isDefault: false,
			sourceTypes: ["video"],
			children: [],
			output: "{id}_720_1800.mp4",
			params: { ...h264, height: 720, videoBitrateK: 1800, audioBitrateK: 256 }
		},
		{
			name: "mp4_1080",
			version: 1,
			type: "video",
			priority: 110,
			isDefault: false,
			sourceTypes: ["video"],
			children: [],
			output: "{id}_1080_2700.mp4",
			params: { ...h264, height: 1080, videoBitrateK: 2700, audioBitrateK: 256 }
		},
		{
			name: "image",
			version: 1,
			type: "image",
			priority: 10,
			isDefault: true,
			sourceTypes: ["image"],
			children: ["image_still"],
			output: "{id}.jpg",
			params: { format: "jpg", quality: 90 }
		},
		{
			name: "image_still",
			version: 1,
			type: "stills",
			priority: 10,
			isDefault: false,
			sourceTypes: ["image"],
			children: [],
			output: "tmb/%04d.jpg",
			params: { fps: "1", maxCount: 1 }
		}
	],
	postProcess: {
		transcribe: true,
		sceneDetection: true
	}
};
