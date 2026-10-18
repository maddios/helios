import type {
	ImageSourceMetadata,
	QueueName,
	RequestMode,
	ResolvedPostProcess,
	VideoSourceMetadata
} from "@helios/contracts";
import { genericPreset } from "../src/presets";
import { planItems } from "../src/pipeline";

const thresholds = { maxDurationSec: 180, maxSourceBytes: 524288000 };
const allPostProcess: ResolvedPostProcess = { transcribe: { translateToEnglish: true }, sceneDetection: true };

function video(overrides: Partial<VideoSourceMetadata> = {}): VideoSourceMetadata {
	return {
		type: "video",
		sizeBytes: 1000000,
		width: 1920,
		height: 1080,
		durationSec: 60,
		fps: 30,
		videoCodec: "h264",
		hasAudio: true,
		...overrides
	};
}

const image: ImageSourceMetadata = { type: "image", sizeBytes: 1000000, width: 1920, height: 1080, hasAudio: false };

function plan(
	overrides: {
		source?: VideoSourceMetadata | ImageSourceMetadata;
		postProcess?: ResolvedPostProcess;
		mode?: RequestMode;
	} = {}
) {
	return planItems({
		preset: genericPreset,
		source: overrides.source ?? video(),
		postProcess: overrides.postProcess ?? allPostProcess,
		mode: overrides.mode ?? "encode",
		thresholds
	});
}

function byKey(items: ReturnType<typeof plan>, key: string) {
	const item = items.find((candidate) => candidate.key === key);
	if (!item) {
		throw new Error(`No item ${key}`);
	}
	return item;
}

function queuesByKey(items: ReturnType<typeof plan>): Record<string, QueueName> {
	return Object.fromEntries(items.map((item) => [item.key, item.queue]));
}

describe("planItems", () => {
	it("plans encode and AI items for a 1080p video with audio", () => {
		const items = plan();
		expect(items.map((item) => item.key)).toEqual(["mp4_360", "audio", "mp4_720", "mp4_1080", "transcribe", "scenes"]);
		expect(items.find((item) => item.key === "stills")).toBeUndefined();
		expect(byKey(items, "scenes")).toMatchObject({
			status: "BLOCKED",
			dependsOn: [
				{ key: "mp4_360", required: true },
				{ key: "transcribe", required: false }
			],
			priority: 30
		});
		expect(byKey(items, "transcribe")).toMatchObject({ status: "QUEUED", priority: 20, dependsOn: [] });
	});

	it("drops upscaled renditions for a 720p source", () => {
		const keys = plan({ source: video({ height: 720 }) }).map((item) => item.key);
		expect(keys).not.toContain("mp4_1080");
		expect(keys).toContain("mp4_720");
	});

	it("keeps only the default video and audio for a 300p source", () => {
		const keys = plan({ source: video({ height: 300 }) }).map((item) => item.key);
		expect(keys).toEqual(["mp4_360", "audio", "transcribe", "scenes"]);
	});

	it("keeps mp4_720 for a 650p source", () => {
		const keys = plan({ source: video({ height: 650 }) }).map((item) => item.key);
		expect(keys).toContain("mp4_720");
		expect(keys).not.toContain("mp4_1080");
	});

	it("omits audio and skips transcribe for a silent video", () => {
		const items = plan({ source: video({ hasAudio: false }) });
		expect(items.map((item) => item.key)).not.toContain("audio");
		expect(byKey(items, "transcribe").status).toBe("SKIPPED");
		expect(byKey(items, "scenes")).toMatchObject({
			status: "BLOCKED",
			dependsOn: [{ key: "mp4_360", required: true }]
		});
	});

	it("plans only the image item and scenes for an image source", () => {
		const items = plan({ source: image });
		expect(items.map((item) => item.key)).toEqual(["image", "scenes"]);
		expect(byKey(items, "scenes")).toMatchObject({ status: "BLOCKED", dependsOn: [{ key: "image", required: true }] });
	});

	it("routes an image source to lambda", () => {
		const queues = queuesByKey(plan({ source: image }));
		expect(queues.image).toBe("lambda-p1");
		expect(queues.scenes).toBe("lambda-ai");
	});

	it("routes a duration at the threshold to lambda", () => {
		const queues = queuesByKey(plan({ source: video({ durationSec: 180 }) }));
		expect(queues.mp4_360).toBe("lambda-p1");
		expect(queues.transcribe).toBe("lambda-ai");
	});

	it("routes a duration over the threshold to fargate", () => {
		const queues = queuesByKey(plan({ source: video({ durationSec: 181 }) }));
		expect(queues.mp4_360).toBe("fargate-p1");
		expect(queues.transcribe).toBe("fargate-p3");
	});

	it("routes a size exactly at the limit to lambda", () => {
		const queues = queuesByKey(plan({ source: video({ sizeBytes: 524288000, durationSec: 180 }) }));
		expect(queues.mp4_360).toBe("lambda-p1");
		expect(queues.scenes).toBe("lambda-ai");
	});

	it("routes a source over the size limit to fargate", () => {
		const queues = queuesByKey(plan({ source: video({ sizeBytes: 524288001 }) }));
		expect(queues.mp4_360).toBe("fargate-p1");
		expect(queues.scenes).toBe("fargate-p3");
	});

	it("always routes non-default encodes to fargate-p2", () => {
		const queues = queuesByKey(plan());
		expect(queues.mp4_720).toBe("fargate-p2");
		expect(queues.audio).toBe("fargate-p2");
	});

	it("routes every item to fargate-p4 when re-encoding", () => {
		const items = plan({ mode: "reencode" });
		expect(items.every((item) => item.queue === "fargate-p4")).toBe(true);
	});

	it("plans only AI items in postProcess mode", () => {
		const items = plan({ mode: "postProcess" });
		expect(items.map((item) => item.key)).toEqual(["transcribe", "scenes"]);
		expect(byKey(items, "scenes")).toMatchObject({
			status: "BLOCKED",
			dependsOn: [{ key: "transcribe", required: false }]
		});
	});

	it("queues scenes without a default dependency when transcribe is disabled in postProcess mode", () => {
		const items = plan({
			mode: "postProcess",
			postProcess: { transcribe: false, sceneDetection: true }
		});
		expect(items.map((item) => item.key)).toEqual(["scenes"]);
		expect(byKey(items, "scenes")).toMatchObject({ status: "QUEUED", dependsOn: [] });
	});

	it("plans no AI items when transcribe and scene detection are disabled in postProcess mode", () => {
		const items = plan({
			mode: "postProcess",
			postProcess: { transcribe: false, sceneDetection: false }
		});
		expect(items).toEqual([]);
	});
});
