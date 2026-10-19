import type { PipelineRequest } from "@helios/core";
import { removeStaleTranscripts, storeTranscript, UsageMeter } from "@helios/core";
import { transcribeHandler } from "../../../src/handlers/transcribe";
import type { HandlerContext } from "../../../src/handlers/types";
import { transcribeSource } from "../../../src/transcribe/transcribeSource";
import { translateSegments } from "../../../src/transcribe/translateSegments";

jest.mock("@helios/core", () => ({
	...jest.requireActual("@helios/core"),
	storeTranscript: jest.fn(),
	removeStaleTranscripts: jest.fn()
}));
jest.mock("../../../src/transcribe/transcribeSource");
jest.mock("../../../src/transcribe/translateSegments", () => ({
	...jest.requireActual("../../../src/transcribe/translateSegments"),
	translateSegments: jest.fn()
}));

const storeMock = storeTranscript as jest.MockedFunction<typeof storeTranscript>;
const removeMock = removeStaleTranscripts as jest.MockedFunction<typeof removeStaleTranscripts>;
const sourceMock = transcribeSource as jest.MockedFunction<typeof transcribeSource>;
const translateMock = translateSegments as jest.MockedFunction<typeof translateSegments>;

const SEGMENTS = [{ start: 0, end: 5, text: "hola" }];

function contextWith(transcribe: unknown, signal = new AbortController().signal): HandlerContext {
	return {
		item: {} as HandlerContext["item"],
		request: { _id: "req-1", postProcess: { transcribe, sceneDetection: false } } as unknown as PipelineRequest,
		asset: { _id: "asset-1", accountId: "acct-1" } as HandlerContext["asset"],
		slug: "acct",
		workDir: "/work/item-1",
		signal,
		meter: new UsageMeter(),
		reportProgress: () => undefined
	};
}

function source(language: string) {
	return { language, segments: SEGMENTS, durationSec: 5 };
}

describe("transcribe handler", () => {
	beforeEach(() => {
		storeMock.mockImplementation(async ({ language, isTranslation }) => ({
			keys: {
				srt: `acct/media/asset-1/transcript/${language}.srt`,
				vtt: `acct/media/asset-1/transcript/${language}.vtt`,
				txt: `acct/media/asset-1/transcript/${language}.txt`
			},
			revision: isTranslation ? 2 : 1
		}));
	});

	it("stores only the native track for an English source", async () => {
		sourceMock.mockResolvedValueOnce(source("en"));

		const result = await transcribeHandler(contextWith({ translateToEnglish: true }));

		expect(translateMock).not.toHaveBeenCalled();
		expect(storeMock).toHaveBeenCalledTimes(1);
		expect(storeMock.mock.calls[0][0]).toMatchObject({ language: "en", isTranslation: false, model: "whisper-1" });
		expect(result.output.transcripts).toEqual([
			{
				language: "en",
				isTranslation: false,
				revision: 1,
				keys: expect.objectContaining({ srt: expect.any(String) })
			}
		]);
		expect(removeMock).toHaveBeenCalledWith("acct", "asset-1", [
			{ language: "en", isTranslation: false, revision: 1, keys: expect.any(Object) }
		]);
	});

	it("stores the native track and an English translation for a non-English source", async () => {
		sourceMock.mockResolvedValueOnce(source("es"));
		const meter = new UsageMeter();
		const context = contextWith({ translateToEnglish: true });
		translateMock.mockResolvedValueOnce({ segments: [{ start: 0, end: 5, text: "hello" }], model: "gpt-test" });

		const result = await transcribeHandler({ ...context, meter });

		expect(translateMock).toHaveBeenCalledWith({
			segments: SEGMENTS,
			sourceLanguage: "es",
			meter,
			signal: context.signal
		});
		expect(storeMock.mock.calls.map(([input]) => [input.language, input.isTranslation])).toEqual([
			["es", false],
			["en", true]
		]);
		expect(storeMock.mock.calls[1][0]).toMatchObject({
			segments: [{ start: 0, end: 5, text: "hello" }],
			model: "gpt-test"
		});
		expect(result.output.transcripts?.map((transcript) => [transcript.language, transcript.isTranslation])).toEqual([
			["es", false],
			["en", true]
		]);
	});

	it("skips translation when translateToEnglish is false and drops stale rows of the other track", async () => {
		sourceMock.mockResolvedValueOnce(source("es"));

		const result = await transcribeHandler(contextWith({ translateToEnglish: false }));

		expect(translateMock).not.toHaveBeenCalled();
		expect(result.output.transcripts).toHaveLength(1);
		expect(removeMock).toHaveBeenCalledWith("acct", "asset-1", [expect.objectContaining({ language: "es" })]);
	});

	it("passes the request language hint to the source transcription", async () => {
		sourceMock.mockResolvedValueOnce(source("es"));

		await transcribeHandler(contextWith({ language: "es", translateToEnglish: false }));

		expect(sourceMock.mock.calls[0][1]).toBe("es");
	});

	it("rejects a request that does not ask for transcription", async () => {
		await expect(transcribeHandler(contextWith(false))).rejects.toThrow(/does not request transcription/);
		expect(sourceMock).not.toHaveBeenCalled();
	});

	it("propagates an abort and stores nothing", async () => {
		const controller = new AbortController();
		const reason = new Error("Worker stopping");
		sourceMock.mockImplementationOnce(async () => {
			controller.abort(reason);
			controller.signal.throwIfAborted();
			return source("en");
		});

		await expect(transcribeHandler(contextWith({ translateToEnglish: true }, controller.signal))).rejects.toBe(reason);
		expect(storeMock).not.toHaveBeenCalled();
		expect(removeMock).not.toHaveBeenCalled();
	});
});
