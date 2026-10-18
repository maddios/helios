import { genericPreset } from "../src/presets";
import { selectPreset } from "../src/pipeline";

const current = { ...genericPreset, version: 2 };
const snapshot = { ...genericPreset, version: 1 };

describe("selectPreset", () => {
	it("uses the current preset for encode", () => {
		expect(selectPreset({ mode: "encode", current, snapshot })).toBe(current);
	});

	it("uses the current preset for reencode when refreshing", () => {
		expect(selectPreset({ mode: "reencode", current, snapshot, refreshPreset: true })).toBe(current);
	});

	it("uses the snapshot for reencode when not refreshing", () => {
		expect(selectPreset({ mode: "reencode", current, snapshot, refreshPreset: false })).toBe(snapshot);
	});

	it("uses the snapshot for postProcess", () => {
		expect(selectPreset({ mode: "postProcess", current, snapshot })).toBe(snapshot);
	});

	it("throws when reencode needs a missing snapshot", () => {
		expect(() => selectPreset({ mode: "reencode", current })).toThrow("preset snapshot is required");
	});

	it("throws when postProcess has no snapshot", () => {
		expect(() => selectPreset({ mode: "postProcess", current })).toThrow("preset snapshot is required");
	});
});
