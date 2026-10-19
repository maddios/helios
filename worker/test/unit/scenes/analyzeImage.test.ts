import { z } from "zod";
import { chatJson, CHAT_MODELS, UsageMeter } from "@helios/core";
import { analyzeImage } from "../../../src/scenes/analyzeImage";

jest.mock("@helios/core", () => ({ ...jest.requireActual("@helios/core"), chatJson: jest.fn() }));

const chatJsonMock = chatJson as jest.MockedFunction<typeof chatJson>;
const SUMMARY = { title: "Logo", description: "A logo", setting: "studio", products: [], moods: [], tags: [] };

function options(peopleAttributes: boolean) {
	return {
		imageUrl: "data:image/png;base64,AAAA",
		effort: "low" as const,
		temperature: 0,
		peopleAttributes,
		signal: new AbortController().signal,
		meter: new UsageMeter()
	};
}

beforeEach(() => {
	chatJsonMock.mockReset();
});

describe("analyzeImage", () => {
	it("produces a summary only, with no scenes and no transcript", async () => {
		chatJsonMock.mockResolvedValueOnce({ summary: { ...SUMMARY, people: [] } });

		const result = await analyzeImage(options(true));

		expect(result).toEqual({
			promptVersion: "scenes-v2",
			model: CHAT_MODELS.low,
			transcriptLanguage: null,
			summary: { ...SUMMARY, people: [] },
			scenes: []
		});
		expect(chatJsonMock.mock.calls[0][0]).toMatchObject({ schemaName: "scene_summary", effort: "low" });
	});

	it("stores empty people when people attributes are off", async () => {
		chatJsonMock.mockResolvedValueOnce({ summary: SUMMARY });

		const result = await analyzeImage(options(false));

		expect(result.summary.people).toEqual([]);
		expect(JSON.stringify(z.toJSONSchema(chatJsonMock.mock.calls[0][0].schema))).not.toContain('"people"');
	});
});
