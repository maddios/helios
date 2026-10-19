import { normalizePartnrup, parseTimestamp } from "../partnrup";

describe("parseTimestamp", () => {
	it("accepts comma and dot fractions and bare seconds", () => {
		expect(parseTimestamp("00:00:18,000")).toBe(18);
		expect(parseTimestamp("00:01:02.5")).toBe(62.5);
		expect(parseTimestamp("00:00:03")).toBe(3);
	});

	it("rejects malformed values", () => {
		expect(parseTimestamp("bad")).toBeUndefined();
		expect(parseTimestamp("00:61:00,000")).toBeUndefined();
		expect(parseTimestamp(null)).toBeUndefined();
	});
});

describe("normalizePartnrup", () => {
	it("sorts scenes, ends each at the next start and the last at the duration", () => {
		const baseline = normalizePartnrup(
			[
				{ timestamp: "00:00:10,000", reason_for_scene_transition: "b", description: "second" },
				{ timestamp: "00:00:00,000", reason_for_scene_transition: "a", description: "first" }
			],
			30
		);
		expect(baseline.invalidCount).toBe(0);
		expect(baseline.scenes).toEqual([
			{ startSec: 0, endSec: 10, reason: "a", description: "first" },
			{ startSec: 10, endSec: 30, reason: "b", description: "second" }
		]);
	});

	it("counts unparseable, missing and out-of-range entries as invalid", () => {
		const baseline = normalizePartnrup(
			[
				{ timestamp: "00:00:05,000", description: "ok" },
				{ timestamp: null, description: "no time" },
				{ timestamp: "00:00:40,000", description: "past the end" },
				"not an object"
			],
			30
		);
		expect(baseline.scenes.map((scene) => scene.startSec)).toEqual([5]);
		expect(baseline.invalidCount).toBe(3);
	});

	it("treats a non-array payload as having no scenes", () => {
		expect(normalizePartnrup({ description: "summary only" }, 30)).toEqual({ scenes: [], invalidCount: 0 });
	});
});
