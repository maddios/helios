import { z } from "zod";
import { CHAT_MODELS, chatJson, UsageMeter } from "@helios/core";
import { analyzeScenes } from "../../../src/scenes/analyzeScenes";
import { type AnalyzeScenesInput, SceneInputError, SceneOutputError, type StillInput } from "../../../src/scenes/types";
import { windowUserContent } from "../../../src/ai/prompts/scenes/v1";

jest.mock("@helios/core", () => ({ ...jest.requireActual("@helios/core"), chatJson: jest.fn() }));

const chatJsonMock = chatJson as jest.MockedFunction<typeof chatJson>;

const SUMMARY = {
	title: "Kitchen",
	description: "A cook",
	setting: "kitchen",
	products: [],
	people: [],
	moods: [],
	tags: []
};

const PERSON = {
	species: "human",
	genderPresentation: "feminine",
	approximateAge: "25-34",
	skinTone: "medium",
	skinUndertone: "warm",
	hairTexture: "curly",
	curlType: "2A",
	hairColor: "black",
	hairLength: "long",
	facialHair: null,
	visibleMakeup: "natural",
	mood: "calm"
};

const OTHER_PERSON = { ...PERSON, approximateAge: "45-54", skinTone: "deep", hairTexture: "coily", curlType: null };

function stillsAt(timesSec: number[]): StillInput[] {
	return timesSec.map((timestampSec, index) => ({ index, timestampSec, key: `key-${index}` }));
}

function modelScene(startSec: number, representativeStillIndex: number, extra: Record<string, unknown> = {}) {
	return {
		reasonForTransition: "change of topic",
		startSec,
		transcriptExcerpt: null,
		description: `scene at ${startSec}`,
		setting: "room",
		products: [],
		people: [],
		representativeStillIndex,
		continuesPrevious: false,
		...extra
	};
}

function input(overrides: Partial<AnalyzeScenesInput> = {}): AnalyzeScenesInput {
	return {
		durationSec: 12,
		stills: stillsAt([0, 3, 6, 9]),
		resolveImage: jest.fn(async (key: string) => `url:${key}`),
		imageConcurrency: 8,
		transcript: null,
		peopleAttributes: true,
		effort: "medium",
		temperature: 0.1,
		maxStills: 120,
		windowSec: 600,
		snapToleranceSec: 3,
		signal: new AbortController().signal,
		meter: new UsageMeter(),
		...overrides
	};
}

function userText(callIndex: number): string {
	const user = chatJsonMock.mock.calls[callIndex][0].user;
	return typeof user === "string" ? user : user.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function callAt(callIndex: number) {
	return chatJsonMock.mock.calls[callIndex][0];
}

beforeEach(() => {
	chatJsonMock.mockReset();
});

describe("analyzeScenes", () => {
	it("analyzes a single window in one call and covers the duration", async () => {
		chatJsonMock.mockResolvedValueOnce({ summary: SUMMARY, scenes: [modelScene(0, 0), modelScene(6, 2)] });

		const result = await analyzeScenes(input());

		expect(chatJsonMock).toHaveBeenCalledTimes(1);
		expect(callAt(0)).toMatchObject({ effort: "medium", temperature: 0.1, schemaName: "scene_window" });
		expect(result).toMatchObject({
			promptVersion: "scenes-v2",
			model: CHAT_MODELS.medium,
			transcriptLanguage: null,
			summary: SUMMARY
		});
		expect(
			result.scenes.map(({ sceneNumber, startSec, endSec, representativeStillIndex }) => [
				sceneNumber,
				startSec,
				endSec,
				representativeStillIndex
			])
		).toEqual([
			[1, 0, 6, 0],
			[2, 6, 12, 2]
		]);
	});

	it("uses the no-people schema and stores empty people when people attributes are off", async () => {
		const { people: _people, ...sceneWithoutPeople } = modelScene(0, 0);
		const { people: _summaryPeople, ...summaryWithoutPeople } = SUMMARY;
		chatJsonMock.mockResolvedValueOnce({ summary: summaryWithoutPeople, scenes: [sceneWithoutPeople] } as never);

		const result = await analyzeScenes(input({ peopleAttributes: false }));

		expect(JSON.stringify(z.toJSONSchema(callAt(0).schema))).not.toContain('"people"');
		expect(result.scenes[0].people).toEqual([]);
		expect(result.summary.people).toEqual([]);
	});

	it("runs one window call per window and a final text-only summary, stitching continuations", async () => {
		chatJsonMock
			.mockResolvedValueOnce({ scenes: [modelScene(0, 0, { products: [{ type: "brand", name: "Acme" }] })] })
			.mockResolvedValueOnce({
				scenes: [
					modelScene(6, 2, {
						continuesPrevious: true,
						products: [
							{ type: "brand", name: "Acme" },
							{ type: "brand", name: "Bolt" }
						]
					})
				]
			})
			.mockResolvedValueOnce({ summary: SUMMARY });

		const result = await analyzeScenes(input({ windowSec: 6 }));

		expect(chatJsonMock).toHaveBeenCalledTimes(3);
		expect(callAt(0).schemaName).toBe("scene_windowed");
		expect(callAt(2)).toMatchObject({ schemaName: "scene_summary" });
		expect(typeof callAt(2).user).toBe("string");
		expect(userText(1)).toContain("Previous window's last scene (setting: room): scene at 0");
		expect(result.scenes).toHaveLength(1);
		expect(result.scenes[0]).toMatchObject({ startSec: 0, endSec: 12, description: "scene at 0" });
		expect(result.scenes[0].products).toEqual([
			{ type: "brand", name: "Acme" },
			{ type: "brand", name: "Bolt" }
		]);
	});

	it("builds the windowed summary's people as the union of the scene people, using the no-people summary schema", async () => {
		chatJsonMock
			.mockResolvedValueOnce({ scenes: [modelScene(0, 0, { people: [PERSON] })] })
			.mockResolvedValueOnce({
				scenes: [modelScene(6, 2, { people: [PERSON, OTHER_PERSON] })]
			})
			.mockResolvedValueOnce({ summary: SUMMARY });

		const result = await analyzeScenes(input({ windowSec: 6 }));

		expect(result.summary.people).toEqual([PERSON, OTHER_PERSON]);
		expect(JSON.stringify(z.toJSONSchema(callAt(2).schema))).not.toContain('"people"');
	});

	it("never merges a scene that is not the first of a window after the first", async () => {
		chatJsonMock
			.mockResolvedValueOnce({ scenes: [modelScene(0, 0, { continuesPrevious: true })] })
			.mockResolvedValueOnce({
				scenes: [modelScene(6, 2), modelScene(9, 3, { continuesPrevious: true })]
			})
			.mockResolvedValueOnce({ summary: SUMMARY });

		const result = await analyzeScenes(input({ windowSec: 6 }));

		expect(result.scenes.map((scene) => [scene.startSec, scene.endSec])).toEqual([
			[0, 6],
			[6, 9],
			[9, 12]
		]);
	});

	it("never merges a single window's scenes, whatever continuesPrevious says", async () => {
		chatJsonMock.mockResolvedValueOnce({
			summary: SUMMARY,
			scenes: [modelScene(0, 0), modelScene(6, 2, { continuesPrevious: true })]
		});

		const result = await analyzeScenes(input());

		expect(result.scenes.map((scene) => scene.startSec)).toEqual([0, 6]);
	});

	it("passes only the windowed stills to each window, resolving only the sampled ones", async () => {
		const stills = stillsAt([0, 3, 6, 9, 12, 15]);
		const resolveImage = jest.fn(async (key: string) => `url:${key}`);
		chatJsonMock
			.mockResolvedValueOnce({ scenes: [modelScene(0, 0)] })
			.mockResolvedValueOnce({ scenes: [modelScene(12, 4)] })
			.mockResolvedValueOnce({ summary: SUMMARY });

		await analyzeScenes(input({ stills, durationSec: 18, windowSec: 12, maxStills: 2, resolveImage }));

		expect(userText(0)).toContain("Still 0 at 0s");
		expect(userText(0)).toContain("Still 2 at 6s");
		expect(userText(0)).not.toContain("Still 1 at 3s");
		expect(userText(0)).not.toContain("Still 4 at 12s");
		expect(userText(1)).toContain("Still 4 at 12s");
		expect(userText(1)).toContain("Still 5 at 15s");
		expect(resolveImage.mock.calls.map(([key]) => key).sort()).toEqual(["key-0", "key-2", "key-4", "key-5"]);
	});

	it("bounds concurrent image resolution to imageConcurrency", async () => {
		let inFlight = 0;
		let peak = 0;
		const resolveImage = async (key: string) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight -= 1;
			return `url:${key}`;
		};
		chatJsonMock.mockResolvedValueOnce({ summary: SUMMARY, scenes: [modelScene(0, 0)] });

		await analyzeScenes(
			input({ stills: stillsAt([0, 1, 2, 3, 4, 5]), durationSec: 6, resolveImage, imageConcurrency: 2 })
		);

		expect(peak).toBe(2);
		expect(userText(0)).toContain("Still 5 at 5s");
	});

	it("passes transcript lines of each window, or states that none exist", async () => {
		const transcript = {
			language: "en",
			segments: [
				{ start: 0.5, end: 2, text: "hello" },
				{ start: 7, end: 9, text: "later words" }
			]
		};
		chatJsonMock
			.mockResolvedValueOnce({ scenes: [modelScene(0, 0)] })
			.mockResolvedValueOnce({ scenes: [modelScene(6, 2)] })
			.mockResolvedValueOnce({ summary: SUMMARY });

		await analyzeScenes(input({ transcript, windowSec: 6 }));

		expect(userText(0)).toContain("[0.5-2] hello");
		expect(userText(0)).not.toContain("later words");
		expect(userText(1)).toContain("[7-9] later words");
	});

	it("reports no transcript and keeps the stored language null", async () => {
		chatJsonMock.mockResolvedValueOnce({ summary: SUMMARY, scenes: [modelScene(0, 0)] });

		const result = await analyzeScenes(input());

		expect(userText(0)).toContain("No transcript is available for this video.");
		expect(result.transcriptLanguage).toBeNull();
	});

	it("snaps a start to the nearest provided time within tolerance", async () => {
		chatJsonMock.mockResolvedValueOnce({ summary: SUMMARY, scenes: [modelScene(0, 0), modelScene(2.9, 1)] });

		const result = await analyzeScenes(input());

		expect(result.scenes.map((scene) => [scene.startSec, scene.endSec])).toEqual([
			[0, 3],
			[3, 12]
		]);
	});

	it("merges a scene that snaps onto the previous start into that scene", async () => {
		chatJsonMock.mockResolvedValueOnce({
			summary: SUMMARY,
			scenes: [modelScene(0, 0), modelScene(9, 3), modelScene(9.2, 2, { products: [{ type: "brand", name: "Acme" }] })]
		});

		const result = await analyzeScenes(input());

		expect(result.scenes.map((scene) => [scene.startSec, scene.endSec])).toEqual([
			[0, 9],
			[9, 12]
		]);
		expect(result.scenes[1].products).toEqual([{ type: "brand", name: "Acme" }]);
	});

	it.each([
		{
			name: "start outside the snap tolerance",
			overrides: { snapToleranceSec: 1 },
			scenes: [modelScene(0, 0), modelScene(4.5, 1)],
			error: SceneOutputError
		},
		{
			name: "representative still that was not provided",
			overrides: {},
			scenes: [modelScene(0, 0), modelScene(6, 99)],
			error: SceneOutputError
		},
		{
			name: "representative still outside its scene",
			overrides: {},
			scenes: [modelScene(0, 0), modelScene(6, 0)],
			error: SceneOutputError
		},
		{
			name: "starts out of order",
			overrides: {},
			scenes: [modelScene(0, 0), modelScene(6, 2), modelScene(3, 1)],
			error: SceneOutputError
		},
		{
			name: "no scenes at all",
			overrides: {},
			scenes: [],
			error: SceneOutputError
		}
	])("rejects output with $name", async ({ overrides, scenes, error }) => {
		chatJsonMock.mockResolvedValueOnce({ summary: SUMMARY, scenes });

		await expect(analyzeScenes(input(overrides))).rejects.toBeInstanceOf(error);
	});

	it("rejects a windowed analysis when any window returns no scenes", async () => {
		chatJsonMock.mockResolvedValueOnce({ scenes: [modelScene(0, 0)] }).mockResolvedValueOnce({ scenes: [] });

		await expect(analyzeScenes(input({ windowSec: 6 }))).rejects.toBeInstanceOf(SceneOutputError);
	});

	it("rejects an asset without stills inside its duration", async () => {
		await expect(analyzeScenes(input({ stills: [] }))).rejects.toBeInstanceOf(SceneInputError);
		expect(chatJsonMock).not.toHaveBeenCalled();
	});

	it("builds the window prompt from the resolved window stills and allowed times", async () => {
		chatJsonMock.mockResolvedValueOnce({ summary: SUMMARY, scenes: [modelScene(0, 0)] });

		await analyzeScenes(input({ stills: stillsAt([0]), durationSec: 3 }));

		expect(callAt(0).user).toEqual(
			windowUserContent({
				durationSec: 3,
				startSec: 0,
				endSec: 3,
				stills: [{ index: 0, timestampSec: 0, imageUrl: "url:key-0" }],
				allowedTimes: [0],
				transcript: null,
				previous: null
			})
		);
	});
});
