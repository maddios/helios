import { assetPrefix, outputKey, pickActiveStill, stillKey, stillsPrefix } from "../src/assets";

describe("asset keys", () => {
	it("builds the asset prefix under the account slug", () => {
		expect(assetPrefix("acme", "asset-1")).toBe("acme/media/asset-1/");
	});

	it("derives the stills key and prefix from the profile output template", () => {
		expect(stillKey("acme", "asset-1", "tmb/%04d.jpg", "0002.jpg")).toBe("acme/media/asset-1/tmb/0002.jpg");
		expect(stillsPrefix("acme", "asset-1", "tmb/%04d.jpg")).toBe("acme/media/asset-1/tmb/");
		expect(stillKey("acme", "asset-1", "{id}-stills/%04d.jpg", "0001.jpg")).toBe(
			"acme/media/asset-1/asset-1-stills/0001.jpg"
		);
	});

	it("refuses a stills template without a directory, so stale-still cleanup never reaches the asset root", () => {
		expect(() => stillsPrefix("acme", "asset-1", "%04d.jpg")).toThrow(/must include a directory/);
	});

	it("replaces {id} with the asset id under the prefix", () => {
		expect(outputKey("acme", "asset-1", "{id}_720.mp4")).toBe("acme/media/asset-1/asset-1_720.mp4");
		expect(outputKey("acme", "asset-1", "tmb/{id}-{id}.jpg")).toBe("acme/media/asset-1/tmb/asset-1-asset-1.jpg");
	});
});

describe("pickActiveStill", () => {
	const stills = [
		{ key: "tmb/0001.jpg", timestampSec: 0 },
		{ key: "tmb/0002.jpg", timestampSec: 3 },
		{ key: "tmb/0003.jpg", timestampSec: 6 }
	];

	it("defaults to the first still when there is no previous selection", () => {
		expect(pickActiveStill(undefined, stills)).toEqual({ index: 0, timestampSec: 0, selectedByUser: false });
	});

	it("drops a previous automatic selection back to the first still", () => {
		expect(pickActiveStill({ index: 2, timestampSec: 6, selectedByUser: false }, stills)).toEqual({
			index: 0,
			timestampSec: 0,
			selectedByUser: false
		});
	});

	it("maps a user selection to the nearest still by timestamp", () => {
		expect(pickActiveStill({ index: 1, timestampSec: 4.4, selectedByUser: true }, stills)).toEqual({
			index: 1,
			timestampSec: 3,
			selectedByUser: true
		});
		expect(pickActiveStill({ index: 1, timestampSec: 5.1, selectedByUser: true }, stills)).toEqual({
			index: 2,
			timestampSec: 6,
			selectedByUser: true
		});
	});

	it("throws when there are no stills", () => {
		expect(() => pickActiveStill(undefined, [])).toThrow();
	});
});
