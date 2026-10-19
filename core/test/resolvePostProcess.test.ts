import { ValidationError } from "@helios/contracts";
import { resolvePostProcess } from "../src/pipeline";

const defaults = { transcribe: true, sceneDetection: true };
const DEFAULT_TRANSCRIBE = { translations: [], english: true, retranscribe: false };

describe("resolvePostProcess", () => {
	it("uses the defaults when the request is undefined", () => {
		expect(resolvePostProcess(undefined, defaults)).toEqual({
			transcribe: DEFAULT_TRANSCRIBE,
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
		expect(resolvePostProcess({ transcribe: true }, { transcribe: false, sceneDetection: false }).transcribe).toEqual(
			DEFAULT_TRANSCRIBE
		);
	});

	it("disables transcription when transcribe is false", () => {
		expect(resolvePostProcess({ transcribe: false }, defaults).transcribe).toBe(false);
	});

	it("defaults english to true, retranscribe to false and omits an undefined language", () => {
		const transcribe = resolvePostProcess({ transcribe: {} }, defaults).transcribe;
		expect(transcribe).toEqual(DEFAULT_TRANSCRIBE);
		expect(transcribe).not.toHaveProperty("language");
	});

	it("keeps the requested language, translations, english and retranscribe values", () => {
		expect(
			resolvePostProcess(
				{ transcribe: { language: "pt", english: false, translations: ["es"], retranscribe: true } },
				defaults
			).transcribe
		).toEqual({ language: "pt", translations: ["es"], english: false, retranscribe: true });
	});

	it("deduplicates translations and keeps their order", () => {
		expect(resolvePostProcess({ transcribe: { translations: ["fr", "es", "fr"] } }, defaults).transcribe).toMatchObject(
			{ translations: ["fr", "es"] }
		);
	});

	it("rejects a language hint that is not in the language table", () => {
		expect(() => resolvePostProcess({ transcribe: { language: "klingon" } }, defaults)).toThrow(ValidationError);
		expect(() => resolvePostProcess({ transcribe: { language: "Spanish" } }, defaults)).toThrow(ValidationError);
	});

	it("lists every unknown translation code in the validation error", () => {
		const error = (() => {
			try {
				resolvePostProcess({ transcribe: { language: "es", translations: ["fr", "xx", "zz", "xx"] } }, defaults);
			} catch (err) {
				return err;
			}
		})();

		expect(error).toBeInstanceOf(ValidationError);
		expect((error as ValidationError).message).toBe("Unsupported transcription languages: xx, zz");
		expect((error as ValidationError).details).toEqual({ languages: ["xx", "zz"] });
	});

	it("uses the request scene detection value when defined", () => {
		expect(resolvePostProcess({ sceneDetection: false }, defaults).sceneDetection).toBe(false);
	});

	it("falls back to the default scene detection value when undefined", () => {
		expect(resolvePostProcess({}, { transcribe: true, sceneDetection: false }).sceneDetection).toBe(false);
	});
});
