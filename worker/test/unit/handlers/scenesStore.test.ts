import { sceneAnalyses } from "@helios/core";
import type { SceneAnalysisResult } from "@helios/contracts";
import { storeSceneAnalysis } from "../../../src/handlers/scenesStore";

jest.mock("@helios/core", () => ({ ...jest.requireActual("@helios/core"), sceneAnalyses: jest.fn() }));

const ANALYSIS = {
	promptVersion: "scenes-v2",
	model: "gpt-6-sol",
	transcriptLanguage: null,
	summary: { title: "Title", description: "d", setting: "s", products: [], people: [], moods: [], tags: [] },
	scenes: []
} as SceneAnalysisResult;

describe("storeSceneAnalysis", () => {
	const updateOne = jest.fn();

	beforeEach(() => {
		updateOne.mockReset().mockResolvedValue({});
		jest.mocked(sceneAnalyses).mockReturnValue({ updateOne } as never);
	});

	it("upserts by asset and item, sets the asset version, and assigns _id only on insert", async () => {
		await storeSceneAnalysis({ accountId: "acct", assetId: "asset", itemId: "item-1", assetVersion: 3 }, ANALYSIS);

		const [filter, update, options] = updateOne.mock.calls[0];
		expect(filter).toEqual({ assetId: "asset", itemId: "item-1" });
		expect(options).toEqual({ upsert: true });
		expect(update.$set).toMatchObject({ accountId: "acct", assetVersion: 3, promptVersion: "scenes-v2" });
		expect(update.$set).not.toHaveProperty("_id");
		expect(Object.keys(update.$setOnInsert)).toEqual(["_id"]);
		expect(typeof update.$setOnInsert._id).toBe("string");
	});
});
