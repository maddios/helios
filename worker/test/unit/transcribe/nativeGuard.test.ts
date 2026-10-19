import { findTranscripts, type TranscriptSummary } from "@helios/core";
import { assertNativeUnchanged, NativeChangedError } from "../../../src/transcribe/nativeGuard";

jest.mock("@helios/core", () => ({ ...jest.requireActual("@helios/core"), findTranscripts: jest.fn() }));

const findMock = findTranscripts as jest.MockedFunction<typeof findTranscripts>;
const scope = { accountId: "acct-1", assetId: "asset-1" };

function summary(language: string, isTranslation: boolean, revision: number): TranscriptSummary {
	return { language, isTranslation, revision } as TranscriptSummary;
}

describe("assertNativeUnchanged", () => {
	it("passes while the native track keeps its language and revision", async () => {
		findMock.mockResolvedValueOnce([summary("es", false, 3), summary("en", true, 1)]);

		await expect(assertNativeUnchanged(scope, { language: "es", revision: 3 })).resolves.toBeUndefined();
	});

	it.each([
		{ name: "the revision changed", stored: [summary("es", false, 4)] },
		{ name: "the native track was removed", stored: [summary("en", true, 1)] },
		{ name: "the native language changed", stored: [summary("fr", false, 3)] }
	])("throws NativeChangedError when $name", async ({ stored }) => {
		findMock.mockResolvedValueOnce(stored);

		await expect(assertNativeUnchanged(scope, { language: "es", revision: 3 })).rejects.toThrow(NativeChangedError);
	});
});
