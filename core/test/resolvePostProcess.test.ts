import { resolvePostProcess } from "../src/pipeline";

const defaults = { transcribe: true, sceneDetection: true };

describe("resolvePostProcess", () => {
	it("uses the defaults when the request is undefined", () => {
		expect(resolvePostProcess(undefined, defaults)).toEqual({
			transcribe: { translateToEnglish: true },
			sceneDetection: true
		});
	});

	it("disables transcription from defaults when the default is false", () => {
		expect(resolvePostProcess(undefined, { transcribe: false, sceneDetection: false })).toEqual({
			transcribe: false,
			sceneDetection: false
		});
	});

	it("enables transcription when transcribe is true", () => {
		expect(resolvePostProcess({ transcribe: true }, { transcribe: false, sceneDetection: false }).transcribe).toEqual({
			translateToEnglish: true
		});
	});

	it("disables transcription when transcribe is false", () => {
		expect(resolvePostProcess({ transcribe: false }, defaults).transcribe).toBe(false);
	});

	it("defaults translateToEnglish to true and omits an undefined language", () => {
		const transcribe = resolvePostProcess({ transcribe: {} }, defaults).transcribe;
		expect(transcribe).toEqual({ translateToEnglish: true });
		expect(transcribe).not.toHaveProperty("language");
	});

	it("keeps the requested language and translation flag", () => {
		expect(
			resolvePostProcess({ transcribe: { language: "fr", translateToEnglish: false } }, defaults).transcribe
		).toEqual({
			language: "fr",
			translateToEnglish: false
		});
	});

	it("uses the request scene detection value when defined", () => {
		expect(resolvePostProcess({ sceneDetection: false }, defaults).sceneDetection).toBe(false);
	});

	it("falls back to the default scene detection value when undefined", () => {
		expect(resolvePostProcess({}, { transcribe: true, sceneDetection: false }).sceneDetection).toBe(false);
	});
});
