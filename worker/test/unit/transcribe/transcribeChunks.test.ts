import { transcribeAudio, UsageMeter } from "@helios/core";
import { cutChunk } from "../../../src/transcribe/cutChunk";
import { transcribeChunks } from "../../../src/transcribe/transcribeChunks";
import type { ChunkPlan } from "../../../src/transcribe/planChunks";

jest.mock("@helios/core", () => ({
	...jest.requireActual("@helios/core"),
	transcribeAudio: jest.fn()
}));
jest.mock("../../../src/transcribe/cutChunk", () => ({ cutChunk: jest.fn() }));

const transcribeMock = transcribeAudio as jest.MockedFunction<typeof transcribeAudio>;

const PLANS: ChunkPlan[] = [
	{ index: 0, start: 0, end: 105, keepFrom: 0, keepUntil: 100 },
	{ index: 1, start: 95, end: 150, keepFrom: 100, keepUntil: Infinity }
];

function options(language?: string) {
	return {
		workDir: "/work",
		...(language !== undefined && { language }),
		meter: new UsageMeter(),
		signal: new AbortController().signal
	};
}

describe("transcribeChunks", () => {
	beforeEach(() => {
		jest.mocked(cutChunk).mockResolvedValue(undefined);
		transcribeMock.mockImplementation(async ({ language }) => ({
			language: language ?? "spanish",
			durationSec: 1,
			segments: [{ start: 0, end: 1, text: "seg" }]
		}));
	});

	it("passes the first chunk's detected language as the hint to the following chunks", async () => {
		const result = await transcribeChunks("/work/audio.mp3", PLANS, options());

		expect(transcribeMock.mock.calls.map(([call]) => call.language)).toEqual([undefined, "spanish"]);
		expect(result.language).toBe("spanish");
	});

	it("sends the request hint with every chunk and keeps it as the stored language", async () => {
		const result = await transcribeChunks("/work/audio.mp3", PLANS, options("es"));

		expect(transcribeMock.mock.calls.map(([call]) => call.language)).toEqual(["es", "es"]);
		expect(result.language).toBe("es");
	});

	it("stops before cutting the next chunk when the signal is aborted", async () => {
		const controller = new AbortController();
		const reason = new Error("Worker stopping");
		transcribeMock.mockImplementationOnce(async () => {
			controller.abort(reason);
			return { language: "spanish", durationSec: 1, segments: [] };
		});

		await expect(transcribeChunks("/work/audio.mp3", PLANS, { ...options(), signal: controller.signal })).rejects.toBe(
			reason
		);
		expect(cutChunk).toHaveBeenCalledTimes(1);
	});
});
