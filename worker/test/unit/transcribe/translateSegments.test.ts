import { chatJson, UsageMeter } from "@helios/core";
import { resetConfigForTests } from "../../../src/config";
import { TranslationMismatchError, translateSegments } from "../../../src/transcribe/translateSegments";

jest.mock("@helios/core", () => ({
	...jest.requireActual("@helios/core"),
	chatJson: jest.fn()
}));

const chatJsonMock = chatJson as jest.MockedFunction<typeof chatJson>;

const SEGMENTS = [
	{ start: 0, end: 1, text: "uno" },
	{ start: 1, end: 2, text: "dos" },
	{ start: 2, end: 3, text: "tres" },
	{ start: 3, end: 4, text: "cuatro" },
	{ start: 4, end: 5, text: "cinco" }
];

function echoTranslation(user: string) {
	const { segments } = JSON.parse(user) as { segments: { index: number; text: string }[] };
	return { segments: segments.map((segment) => ({ index: segment.index, text: `EN ${segment.text}` })) };
}

function input(segments = SEGMENTS, signal = new AbortController().signal) {
	return { segments, sourceLanguage: "es", targetLanguage: "en", meter: new UsageMeter(), signal };
}

describe("translateSegments", () => {
	beforeEach(() => {
		process.env.TRANSLATE_BATCH_SEGMENTS = "2";
		resetConfigForTests();
		chatJsonMock.mockImplementation(async ({ user }) => echoTranslation(user));
	});

	afterEach(() => {
		process.env.TRANSLATE_BATCH_SEGMENTS = "40";
		resetConfigForTests();
	});

	it("translates in batches, keeps order and timings, and names the chat model", async () => {
		const result = await translateSegments(input());

		expect(chatJsonMock).toHaveBeenCalledTimes(3);
		expect(chatJsonMock.mock.calls.map(([call]) => JSON.parse(call.user))).toEqual([
			{
				segments: [
					{ index: 0, text: "uno" },
					{ index: 1, text: "dos" }
				]
			},
			{
				segments: [
					{ index: 0, text: "tres" },
					{ index: 1, text: "cuatro" }
				]
			},
			{ segments: [{ index: 0, text: "cinco" }] }
		]);
		expect(result).toEqual({
			segments: SEGMENTS.map((segment) => ({ start: segment.start, end: segment.end, text: `EN ${segment.text}` })),
			model: "gpt-6-luna"
		});
	});

	it("passes the meter and signal to every batch so usage is recorded per call", async () => {
		const request = input(SEGMENTS.slice(0, 1));

		await translateSegments(request);

		expect(chatJsonMock.mock.calls[0][0]).toMatchObject({
			effort: "low",
			temperature: 0.2,
			meter: request.meter,
			signal: request.signal
		});
		expect(chatJsonMock.mock.calls[0][0].system).toContain("from spanish to english");
	});

	it("stops before the next batch when the signal is aborted", async () => {
		const controller = new AbortController();
		const reason = new Error("Worker stopping");
		chatJsonMock.mockImplementationOnce(async ({ user }) => {
			controller.abort(reason);
			return echoTranslation(user);
		});

		await expect(translateSegments(input(SEGMENTS, controller.signal))).rejects.toBe(reason);
		expect(chatJsonMock).toHaveBeenCalledTimes(1);
	});

	it("names the target language in the prompt", async () => {
		await translateSegments({ ...input(SEGMENTS.slice(0, 1)), targetLanguage: "fr" });

		expect(chatJsonMock.mock.calls[0][0].system).toContain("from spanish to french.");
	});

	it("returns nothing and calls nothing for an empty transcript", async () => {
		expect(await translateSegments(input([]))).toEqual({ segments: [], model: "gpt-6-luna" });
		expect(chatJsonMock).not.toHaveBeenCalled();
	});

	it("rejects a batch whose response count differs from the batch", async () => {
		chatJsonMock.mockResolvedValueOnce({ segments: [{ index: 0, text: "only one" }] });

		await expect(translateSegments(input(SEGMENTS.slice(0, 2)))).rejects.toBeInstanceOf(TranslationMismatchError);
	});

	it("rejects a batch whose indices repeat or skip a position", async () => {
		chatJsonMock.mockResolvedValueOnce({
			segments: [
				{ index: 0, text: "a" },
				{ index: 0, text: "b" }
			]
		});

		await expect(translateSegments(input(SEGMENTS.slice(0, 2)))).rejects.toThrow(TranslationMismatchError);
	});
});
