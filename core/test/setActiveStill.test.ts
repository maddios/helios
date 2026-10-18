import { NotFoundError, ValidationError } from "@helios/contracts";
import { ensureIndexes, mediaAssets, type MediaAsset } from "../src/models";
import { InvalidStillIndexError, setActiveStill } from "../src/assets";
import { asset } from "./helpers/pipelineFixtures";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

const stillsAsset: MediaAsset = {
	...asset,
	outputs: {
		mp4_360: { profileName: "mp4_360", profileVersion: 1, kind: "video", gated: false },
		stills: {
			profileName: "stills",
			profileVersion: 1,
			kind: "stills",
			gated: false,
			items: [
				{ key: "tmb/0001.jpg", timestampSec: 1 },
				{ key: "tmb/0002.jpg", timestampSec: 5 }
			]
		}
	}
};

describe("setActiveStill", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
		await mediaAssets().insertOne(stillsAsset);
	});

	it("selects the still at the given index with its timestamp", async () => {
		const activeStill = await setActiveStill("account-1", "asset-1", 1);

		expect(activeStill).toEqual({ index: 1, timestampSec: 5, selectedByUser: true });
		expect((await mediaAssets().findOne({ _id: "asset-1" }))?.activeStill).toEqual(activeStill);
	});

	it("rejects an index outside the stills", async () => {
		await expect(setActiveStill("account-1", "asset-1", 2)).rejects.toBeInstanceOf(InvalidStillIndexError);
		await expect(setActiveStill("account-1", "asset-1", -1)).rejects.toBeInstanceOf(ValidationError);
		await expect(setActiveStill("account-1", "asset-1", 0.5)).rejects.toBeInstanceOf(ValidationError);
	});

	it("throws NotFoundError for a missing or tombstoned asset", async () => {
		await expect(setActiveStill("account-2", "asset-1", 0)).rejects.toBeInstanceOf(NotFoundError);
		await mediaAssets().updateOne({ _id: "asset-1" }, { $set: { deletedAt: new Date() } });
		await expect(setActiveStill("account-1", "asset-1", 0)).rejects.toBeInstanceOf(NotFoundError);
	});
});
