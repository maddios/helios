import type { PipelineRequest, StoredTranscript, StoreTranscriptInput } from "@helios/core";
import { findNativeSegments, findTranscripts, removeStaleTranscripts, storeTranscript, UsageMeter } from "@helios/core";
import { transcribeHandler } from "../../../src/handlers/transcribe";
import { assertCurrent } from "../../../src/handlers/supersession";
import type { HandlerContext } from "../../../src/handlers/types";
import { resetConfigForTests } from "../../../src/config";
import { NativeChangedError } from "../../../src/transcribe/nativeGuard";
import { transcribeSource } from "../../../src/transcribe/transcribeSource";
import { translateSegments } from "../../../src/transcribe/translateSegments";

jest.mock("@helios/core", () => ({
	...jest.requireActual("@helios/core"),
	storeTranscript: jest.fn(),
	removeStaleTranscripts: jest.fn(),
	findTranscripts: jest.fn(),
	findNativeSegments: jest.fn()
}));
jest.mock("../../../src/handlers/supersession", () => ({ assertCurrent: jest.fn() }));
jest.mock("../../../src/transcribe/transcribeSource");
jest.mock("../../../src/transcribe/translateSegments", () => ({
	...jest.requireActual("../../../src/transcribe/translateSegments"),
	translateSegments: jest.fn()
}));

const storeMock = storeTranscript as jest.MockedFunction<typeof storeTranscript>;
const removeMock = removeStaleTranscripts as jest.MockedFunction<typeof removeStaleTranscripts>;
const findMock = findTranscripts as jest.MockedFunction<typeof findTranscripts>;
const findSegmentsMock = findNativeSegments as jest.MockedFunction<typeof findNativeSegments>;
const sourceMock = transcribeSource as jest.MockedFunction<typeof transcribeSource>;
const translateMock = translateSegments as jest.MockedFunction<typeof translateSegments>;
const assertCurrentMock = assertCurrent as jest.MockedFunction<typeof assertCurrent>;

const ACCOUNT = "acct-1";
const ASSET = "asset-1";
const SEGMENTS = [{ start: 0, end: 5, text: "hola" }];

let db: StoredTranscript[];

interface ContextOptions {
	mode?: "encode" | "reencode" | "postProcess";
	transcribe: unknown;
	signal?: AbortSignal;
}

function contextWith({ mode = "postProcess", transcribe, signal }: ContextOptions): HandlerContext {
	return {
		item: {} as HandlerContext["item"],
		request: {
			_id: "req-1",
			mode,
			assetVersion: 1,
			postProcess: { transcribe, sceneDetection: false }
		} as unknown as PipelineRequest,
		asset: { _id: ASSET, accountId: ACCOUNT } as HandlerContext["asset"],
		slug: "acct",
		workDir: "/work/item-1",
		signal: signal ?? new AbortController().signal,
		meter: new UsageMeter(),
		reportProgress: () => undefined
	};
}

function doc(language: string, isTranslation: boolean, revision = 1): StoredTranscript {
	return {
		_id: `${language}-${isTranslation}`,
		accountId: ACCOUNT,
		assetId: ASSET,
		language,
		isTranslation,
		revision,
		segments: SEGMENTS,
		text: "hola",
		durationSec: 5,
		model: "model",
		createdAt: new Date()
	};
}

function source(language: string) {
	return { language, segments: SEGMENTS, durationSec: 5 };
}

function echo(targetLanguage: string) {
	return { segments: [{ start: 0, end: 5, text: targetLanguage.toUpperCase() }], model: "gpt-test" };
}

function tracks(): string[] {
	return db.map((stored) => `${stored.language}:${stored.isTranslation}`).sort();
}

function revisionOf(language: string, isTranslation: boolean): number | undefined {
	return db.find((stored) => stored.language === language && stored.isTranslation === isTranslation)?.revision;
}

function storedLanguages(): string[] {
	return storeMock.mock.calls.map(([input]) => `${input.language}:${input.isTranslation}`);
}

function translatedTo(): string[] {
	return translateMock.mock.calls.map(([input]) => input.targetLanguage);
}

function setConcurrency(value: string): void {
	process.env.TRANSLATE_TARGET_CONCURRENCY = value;
	resetConfigForTests();
}

function upsert(input: StoreTranscriptInput): number {
	const existing = revisionOf(input.language, input.isTranslation) ?? 0;
	db = db.filter((stored) => stored.language !== input.language || stored.isTranslation !== input.isTranslation);
	db.push({ ...doc(input.language, input.isTranslation, existing + 1), segments: input.segments, model: input.model });
	return existing + 1;
}

describe("transcribe handler", () => {
	beforeEach(() => {
		db = [];
		findMock.mockImplementation(async ({ accountId, assetId }) =>
			db
				.filter((stored) => stored.accountId === accountId && stored.assetId === assetId)
				.map(({ segments, ...summary }) => summary)
		);
		findSegmentsMock.mockImplementation(async (_scope, language) => {
			const native = db.find((stored) => stored.language === language && !stored.isTranslation);
			if (native === undefined) {
				throw new Error(`no native ${language}`);
			}
			return native.segments;
		});
		storeMock.mockImplementation(async (input) => {
			const revision = upsert(input);
			return {
				keys: {
					srt: `acct/media/${ASSET}/transcript/${input.language}.srt`,
					vtt: `acct/media/${ASSET}/transcript/${input.language}.vtt`,
					txt: `acct/media/${ASSET}/transcript/${input.language}.txt`
				},
				revision
			};
		});
		removeMock.mockImplementation(async (_slug, _assetId, kept) => {
			db = db.filter((stored) =>
				kept.some(
					({ language, isTranslation }) => language === stored.language && isTranslation === stored.isTranslation
				)
			);
		});
		translateMock.mockImplementation(async ({ targetLanguage }) => echo(targetLanguage));
		assertCurrentMock.mockResolvedValue(undefined);
	});

	afterEach(() => {
		setConcurrency("3");
	});

	describe("fresh transcription", () => {
		it("stores the native track before the English translation of a Spanish encode", async () => {
			sourceMock.mockResolvedValueOnce(source("es"));

			const result = await transcribeHandler(
				contextWith({ mode: "encode", transcribe: { english: true, translations: [], retranscribe: false } })
			);

			expect(storedLanguages()).toEqual(["es:false", "en:true"]);
			expect(translateMock.mock.calls[0][0]).toMatchObject({ segments: SEGMENTS, sourceLanguage: "es" });
			expect(result.output.transcripts?.map((t) => [t.language, t.isTranslation])).toEqual([
				["es", false],
				["en", true]
			]);
			expect(tracks()).toEqual(["en:true", "es:false"]);
		});

		it("stores extra translations and skips English when english is false", async () => {
			sourceMock.mockResolvedValueOnce(source("es"));

			await transcribeHandler(
				contextWith({ mode: "encode", transcribe: { english: false, translations: ["fr", "de"], retranscribe: false } })
			);

			expect(translatedTo()).toEqual(["de", "fr"]);
			expect(tracks()).toEqual(["de:true", "es:false", "fr:true"]);
		});

		it("stores only the native track for an English source", async () => {
			sourceMock.mockResolvedValueOnce(source("en"));

			await transcribeHandler(
				contextWith({ mode: "encode", transcribe: { english: true, translations: [], retranscribe: false } })
			);

			expect(translateMock).not.toHaveBeenCalled();
			expect(tracks()).toEqual(["en:false"]);
		});

		it("passes the request language hint to the source transcription", async () => {
			sourceMock.mockResolvedValueOnce(source("es"));

			await transcribeHandler(
				contextWith({ transcribe: { language: "es", english: false, translations: [], retranscribe: false } })
			);

			expect(sourceMock.mock.calls[0][1]).toBe("es");
		});

		it("transcribes fresh when a post-process has only translations and no native track is stored", async () => {
			sourceMock.mockResolvedValueOnce(source("es"));

			await transcribeHandler(
				contextWith({ transcribe: { translations: ["fr"], english: false, retranscribe: false } })
			);

			expect(sourceMock).toHaveBeenCalledTimes(1);
			expect(tracks()).toEqual(["es:false", "fr:true"]);
		});
	});

	describe.each([
		{
			name: "postProcess with retranscribe regenerates every stored translation",
			mode: "postProcess",
			stored: [doc("es", false), doc("en", true), doc("fr", true)],
			transcribe: { translations: ["de"], english: true, retranscribe: true },
			spoken: "es",
			expected: ["de:true", "en:true", "es:false", "fr:true"]
		},
		{
			name: "postProcess with a changed hint replaces the native and regenerates the rest",
			mode: "postProcess",
			stored: [doc("es", false), doc("en", true), doc("fr", true)],
			transcribe: { language: "fr", translations: [], english: true, retranscribe: false },
			spoken: "fr",
			expected: ["en:true", "fr:false"]
		},
		{
			name: "reencode keeps the stored language set",
			mode: "reencode",
			stored: [doc("es", false), doc("en", true), doc("ja", true)],
			transcribe: { translations: ["de"], english: true, retranscribe: false },
			spoken: "es",
			expected: ["de:true", "en:true", "es:false", "ja:true"]
		},
		{
			name: "encode replaces the stored language set",
			mode: "encode",
			stored: [doc("es", false), doc("en", true), doc("ja", true)],
			transcribe: { translations: ["de"], english: true, retranscribe: false },
			spoken: "es",
			expected: ["de:true", "en:true", "es:false"]
		},
		{
			name: "postProcess with no native track regenerates the stored translations",
			mode: "postProcess",
			stored: [doc("en", true)],
			transcribe: { translations: ["fr"], english: true, retranscribe: false },
			spoken: "es",
			expected: ["en:true", "es:false", "fr:true"]
		},
		{
			name: "postProcess with two native tracks regenerates from the new native",
			mode: "postProcess",
			stored: [doc("es", false), doc("fr", false), doc("en", true)],
			transcribe: { translations: [], english: true, retranscribe: false },
			spoken: "de",
			expected: ["de:false", "en:true"]
		}
	])("regeneration: $name", ({ mode, stored, transcribe, spoken, expected }) => {
		it("ends with exactly the expected tracks", async () => {
			db = stored;
			sourceMock.mockResolvedValueOnce(source(spoken));

			await transcribeHandler(contextWith({ mode: mode as "encode", transcribe }));

			expect(tracks()).toEqual(expected);
		});
	});

	describe("reusing the stored native track", () => {
		it("translates only the missing targets and keeps existing translations untouched", async () => {
			db = [doc("es", false, 3), doc("en", true, 4), doc("fr", true, 5)];

			const result = await transcribeHandler(
				contextWith({ transcribe: { translations: ["de"], english: true, retranscribe: false } })
			);

			expect(sourceMock).not.toHaveBeenCalled();
			expect(translatedTo()).toEqual(["de"]);
			expect(storedLanguages()).toEqual(["de:true"]);
			expect(removeMock).not.toHaveBeenCalled();
			expect(result.output.transcripts?.map((t) => [t.language, t.isTranslation, t.revision])).toEqual([
				["es", false, 3],
				["de", true, 1],
				["en", true, 4],
				["fr", true, 5]
			]);
		});

		it("does no transcription and no translation when every target is already stored", async () => {
			db = [doc("es", false, 1), doc("en", true, 1)];

			const result = await transcribeHandler(
				contextWith({ transcribe: { translations: [], english: true, retranscribe: false } })
			);

			expect(sourceMock).not.toHaveBeenCalled();
			expect(translateMock).not.toHaveBeenCalled();
			expect(storeMock).not.toHaveBeenCalled();
			expect(result.output.transcripts?.map((t) => t.language)).toEqual(["es", "en"]);
		});

		it("adds English again after an english:false request", async () => {
			db = [doc("es", false)];

			await transcribeHandler(contextWith({ transcribe: { translations: [], english: true, retranscribe: false } }));

			expect(translatedTo()).toEqual(["en"]);
			expect(tracks()).toEqual(["en:true", "es:false"]);
		});

		it("reuses the native track when the hint matches it", async () => {
			db = [doc("es", false)];

			await transcribeHandler(
				contextWith({ transcribe: { language: "es", translations: ["fr"], english: false, retranscribe: false } })
			);

			expect(sourceMock).not.toHaveBeenCalled();
			expect(storedLanguages()).toEqual(["fr:true"]);
		});

		it("transcribes fresh instead of reusing when the native track is ambiguous", async () => {
			db = [doc("es", false), doc("fr", false)];
			sourceMock.mockResolvedValueOnce(source("de"));

			await transcribeHandler(contextWith({ transcribe: { translations: [], english: false, retranscribe: false } }));

			expect(sourceMock).toHaveBeenCalledTimes(1);
			expect(tracks()).toEqual(["de:false"]);
		});

		it("resumes after a partial store, translating only the languages not yet stored", async () => {
			setConcurrency("1");
			db = [doc("es", false)];
			translateMock.mockResolvedValueOnce(echo("de"));
			translateMock.mockRejectedValueOnce(new Error("provider down"));
			const transcribe = { translations: ["de", "fr"], english: false, retranscribe: false };

			await expect(transcribeHandler(contextWith({ transcribe }))).rejects.toThrow("provider down");
			expect(tracks()).toEqual(["de:true", "es:false"]);

			translateMock.mockClear();
			await transcribeHandler(contextWith({ transcribe }));

			expect(translatedTo()).toEqual(["fr"]);
			expect(tracks()).toEqual(["de:true", "es:false", "fr:true"]);
		});

		it("stops without storing a target when the native track is replaced mid-run", async () => {
			db = [doc("es", false, 3)];
			translateMock.mockImplementationOnce(async ({ targetLanguage }) => {
				db = db.map((stored) => (stored.isTranslation ? stored : { ...stored, revision: 4 }));
				return echo(targetLanguage);
			});

			await expect(
				transcribeHandler(contextWith({ transcribe: { translations: ["de"], english: false, retranscribe: false } }))
			).rejects.toThrow(NativeChangedError);
			expect(tracks()).toEqual(["es:false"]);
		});

		it("honors the translation concurrency limit across targets", async () => {
			setConcurrency("2");
			db = [doc("es", false)];
			let inFlight = 0;
			let peak = 0;
			translateMock.mockImplementation(async ({ targetLanguage }) => {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				await new Promise((resolve) => setImmediate(resolve));
				inFlight -= 1;
				return echo(targetLanguage);
			});

			await transcribeHandler(
				contextWith({
					transcribe: { translations: ["de", "fr", "it", "pl", "nl"], english: false, retranscribe: false }
				})
			);

			expect(peak).toBe(2);
			expect(tracks()).toEqual(["de:true", "es:false", "fr:true", "it:true", "nl:true", "pl:true"]);
		});
	});

	it("stops before storing anything when the asset is superseded", async () => {
		assertCurrentMock.mockRejectedValueOnce(new Error("superseded by asset version 2"));
		sourceMock.mockResolvedValueOnce(source("es"));

		await expect(
			transcribeHandler(
				contextWith({ mode: "encode", transcribe: { english: true, translations: [], retranscribe: false } })
			)
		).rejects.toThrow("superseded");
		expect(storeMock).not.toHaveBeenCalled();
		expect(removeMock).not.toHaveBeenCalled();
	});

	it("rejects a request that does not ask for transcription", async () => {
		await expect(transcribeHandler(contextWith({ transcribe: false }))).rejects.toThrow(
			/does not request transcription/
		);
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

		await expect(
			transcribeHandler(
				contextWith({
					mode: "encode",
					transcribe: { english: true, translations: [], retranscribe: false },
					signal: controller.signal
				})
			)
		).rejects.toBe(reason);
		expect(storeMock).not.toHaveBeenCalled();
		expect(removeMock).not.toHaveBeenCalled();
	});
});
