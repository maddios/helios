import type { Account, MediaAsset, PipelineItem, PipelineRequest, StoredTranscript } from "@helios/core";
import { analyzeImage as analyzeImageFn, analyzeScenes as analyzeScenesFn } from "../../../src/scenes";
import { cdnUrl, objectStore, findTrackSegments, findTranscripts, UsageMeter } from "@helios/core";
import { resetConfigForTests } from "../../../src/config";
import { scenesHandler } from "../../../src/handlers/scenes";
import { storeSceneAnalysis } from "../../../src/handlers/scenesStore";
import type { HandlerContext } from "../../../src/handlers/types";
import { assertCurrent } from "../../../src/handlers/supersession";

jest.mock("@helios/core", () => ({
	...jest.requireActual("@helios/core"),
	findTranscripts: jest.fn(),
	findTrackSegments: jest.fn()
}));
jest.mock("../../../src/handlers/supersession", () => ({ assertCurrent: jest.fn() }));
jest.mock("../../../src/handlers/scenesStore", () => ({ storeSceneAnalysis: jest.fn() }));
jest.mock("../../../src/scenes/analyzeScenes", () => ({ analyzeScenes: jest.fn() }));
jest.mock("../../../src/scenes/analyzeImage", () => ({ analyzeImage: jest.fn() }));

const findTranscriptsMock = findTranscripts as jest.MockedFunction<typeof findTranscripts>;
const findSegmentsMock = findTrackSegments as jest.MockedFunction<typeof findTrackSegments>;
const storeMock = storeSceneAnalysis as jest.MockedFunction<typeof storeSceneAnalysis>;
const analyzeScenesMock = analyzeScenesFn as jest.MockedFunction<typeof analyzeScenesFn>;
const analyzeImageMock = analyzeImageFn as jest.MockedFunction<typeof analyzeImageFn>;

const ANALYSIS = {
	promptVersion: "scenes-v2",
	model: "gpt-6-sol",
	transcriptLanguage: null,
	summary: { title: "Title", description: "d", setting: "s", products: [], people: [], moods: [], tags: [] },
	scenes: [
		{
			sceneNumber: 1,
			startSec: 0,
			endSec: 3,
			reasonForTransition: "start",
			transcriptExcerpt: null,
			description: "d",
			setting: "s",
			products: [],
			people: [],
			representativeStillIndex: 0
		}
	]
};

function transcriptDoc(language: string, isTranslation: boolean): StoredTranscript {
	return {
		_id: `${language}-${isTranslation}`,
		accountId: "acct",
		assetId: "asset",
		language,
		isTranslation,
		revision: 1,
		text: "",
		durationSec: 9,
		model: "whisper-1",
		segments: [],
		createdAt: new Date()
	} as unknown as StoredTranscript;
}

function videoAsset(outputs: MediaAsset["outputs"], version = 1): MediaAsset {
	return {
		_id: "asset",
		accountId: "acct",
		source: { type: "upload", key: "k" },
		sourceMetadata: { type: "video", durationSec: 9 },
		version,
		outputs,
		createdAt: new Date(),
		updatedAt: new Date()
	} as unknown as MediaAsset;
}

const STILLS = {
	stills: {
		profileName: "stills",
		profileVersion: 1,
		kind: "stills" as const,
		gated: false,
		items: [
			{ key: "acct/media/asset/tmb/0000.jpg", timestampSec: 0 },
			{ key: "acct/media/asset/tmb/0001.jpg", timestampSec: 3 },
			{ key: "acct/media/asset/tmb/0002.jpg", timestampSec: 6 }
		]
	}
};

function contextFor(asset: MediaAsset, peopleAttributes = false): HandlerContext {
	return {
		item: { _id: "item-1" } as PipelineItem,
		request: { _id: "req-1", mode: "postProcess", assetVersion: asset.version } as unknown as PipelineRequest,
		asset,
		account: { _id: "acct", slug: "acct", features: { peopleAttributes } } as unknown as Account,
		workDir: "/work/item-1",
		signal: new AbortController().signal,
		meter: new UsageMeter(),
		reportProgress: () => undefined
	};
}

beforeEach(() => {
	jest.clearAllMocks();
	process.env.SCENES_IMAGE_TRANSPORT = "url";
	resetConfigForTests();
	findTranscriptsMock.mockResolvedValue([]);
	analyzeScenesMock.mockResolvedValue(ANALYSIS);
	analyzeImageMock.mockResolvedValue({ ...ANALYSIS, scenes: [] });
});

describe("scenesHandler", () => {
	it("passes stills, the duration and the account people setting from the context, then stores and reports the summary", async () => {
		const ctx = contextFor(videoAsset(STILLS, 4), true);

		const result = await scenesHandler(ctx);

		expect(analyzeScenesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				durationSec: 9,
				peopleAttributes: true,
				imageConcurrency: 4,
				stills: [
					{ index: 0, timestampSec: 0, key: "acct/media/asset/tmb/0000.jpg" },
					{ index: 1, timestampSec: 3, key: "acct/media/asset/tmb/0001.jpg" },
					{ index: 2, timestampSec: 6, key: "acct/media/asset/tmb/0002.jpg" }
				],
				transcript: null
			})
		);
		const { resolveImage } = analyzeScenesMock.mock.calls[0][0];
		expect(await resolveImage("acct/media/asset/tmb/0000.jpg")).toBe(cdnUrl("acct/media/asset/tmb/0000.jpg", 4));
		expect(storeMock).toHaveBeenCalledWith(
			{ accountId: "acct", assetId: "asset", itemId: "item-1", assetVersion: 4 },
			ANALYSIS
		);
		expect(assertCurrent).toHaveBeenCalledWith(ctx);
		expect(result).toEqual({ output: { scenes: { sceneCount: 1, title: "Title" } } });
	});

	it("prefers the stored English translation over the native transcript", async () => {
		findTranscriptsMock.mockResolvedValue([transcriptDoc("es", false), transcriptDoc("en", true)]);
		findSegmentsMock.mockResolvedValue([{ start: 0, end: 1, text: "hello" }]);

		await scenesHandler(contextFor(videoAsset(STILLS)));

		expect(findSegmentsMock).toHaveBeenCalledWith(
			{ accountId: "acct", assetId: "asset" },
			{ language: "en", isTranslation: true }
		);
		expect(analyzeScenesMock.mock.calls[0][0].transcript).toEqual({
			language: "en",
			segments: [{ start: 0, end: 1, text: "hello" }]
		});
	});

	it("uses the native transcript when there is no English track", async () => {
		findTranscriptsMock.mockResolvedValue([transcriptDoc("es", false)]);
		findSegmentsMock.mockResolvedValue([{ start: 0, end: 1, text: "hola" }]);

		await scenesHandler(contextFor(videoAsset(STILLS)));

		expect(analyzeScenesMock.mock.calls[0][0].transcript).toEqual({
			language: "es",
			segments: [{ start: 0, end: 1, text: "hola" }]
		});
	});

	it("resolves stills as base64 data urls, downloading them with the handler signal, when the transport is base64", async () => {
		process.env.SCENES_IMAGE_TRANSPORT = "base64";
		resetConfigForTests();
		const download = jest.spyOn(objectStore(), "downloadBuffer").mockResolvedValue(Buffer.from("jpeg"));
		const ctx = contextFor(videoAsset(STILLS));

		await scenesHandler(ctx);

		const { resolveImage } = analyzeScenesMock.mock.calls[0][0];
		expect(await resolveImage("acct/media/asset/tmb/0000.jpg")).toBe(
			`data:image/jpeg;base64,${Buffer.from("jpeg").toString("base64")}`
		);
		expect(download).toHaveBeenCalledWith("acct/media/asset/tmb/0000.jpg", ctx.signal);
	});

	it("rejects a base64 still whose extension has no image mime type", async () => {
		process.env.SCENES_IMAGE_TRANSPORT = "base64";
		resetConfigForTests();
		const gif = videoAsset({
			stills: { ...STILLS.stills, items: [{ key: "acct/media/asset/tmb/0000.gif", timestampSec: 0 }] }
		});

		await scenesHandler(contextFor(gif));
		const { resolveImage } = analyzeScenesMock.mock.calls[0][0];

		await expect(resolveImage("acct/media/asset/tmb/0000.gif")).rejects.toThrow("No image mime type");
	});

	it("summarizes an image asset through the image path", async () => {
		const image = {
			...videoAsset({
				image: { profileName: "image", profileVersion: 1, kind: "image", key: "acct/media/asset/a.jpg", gated: false }
			}),
			sourceMetadata: { type: "image", width: 1, height: 1, hasAudio: false, sizeBytes: 1 }
		} as unknown as MediaAsset;

		await scenesHandler(contextFor(image));

		expect(analyzeScenesMock).not.toHaveBeenCalled();
		expect(analyzeImageMock).toHaveBeenCalledWith(
			expect.objectContaining({ imageUrl: cdnUrl("acct/media/asset/a.jpg", 1), peopleAttributes: false })
		);
	});

	it("fails when the asset has no stills output", async () => {
		await expect(scenesHandler(contextFor(videoAsset({})))).rejects.toThrow("has no stills output");
		expect(analyzeScenesMock).not.toHaveBeenCalled();
	});
});
