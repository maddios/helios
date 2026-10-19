import { resolveTargets } from "../../src/transcripts";

describe("resolveTargets", () => {
	it.each([
		{ native: "es", english: true, translations: [], expected: ["en"] },
		{ native: "es", english: false, translations: [], expected: [] },
		{ native: "es", english: true, translations: ["fr", "de"], expected: ["de", "en", "fr"] },
		{ native: "es", english: false, translations: ["fr"], expected: ["fr"] },
		{ native: "es", english: true, translations: ["en", "fr", "fr"], expected: ["en", "fr"] },
		{ native: "es", english: true, translations: ["es"], expected: ["en"] },
		{ native: "en", english: true, translations: [], expected: [] },
		{ native: "en", english: true, translations: ["es"], expected: ["es"] },
		{ native: "en", english: false, translations: ["en", "de"], expected: ["de"] },
		{ native: "fr", english: false, translations: ["en"], expected: ["en"] }
	])("native $native, english $english, translations $translations -> $expected", (row) => {
		expect(resolveTargets({ native: row.native, english: row.english, translations: row.translations })).toEqual(
			row.expected
		);
	});
});
