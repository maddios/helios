import type { StoredTranscript } from "@helios/core";
import { reusableNative } from "../../../src/transcribe/nativeReuse";

const es = { language: "es", isTranslation: false } as StoredTranscript;
const en = { language: "en", isTranslation: true } as StoredTranscript;
const fr = { language: "fr", isTranslation: false } as StoredTranscript;

describe("reusableNative", () => {
	it.each([
		{
			name: "post-process with no hint",
			mode: "postProcess",
			retranscribe: false,
			hint: undefined,
			stored: [es],
			expected: es
		},
		{
			name: "post-process with a matching hint",
			mode: "postProcess",
			retranscribe: false,
			hint: "es",
			stored: [es],
			expected: es
		},
		{
			name: "post-process with a mismatched hint",
			mode: "postProcess",
			retranscribe: false,
			hint: "fr",
			stored: [es],
			expected: undefined
		},
		{
			name: "post-process with retranscribe",
			mode: "postProcess",
			retranscribe: true,
			hint: undefined,
			stored: [es],
			expected: undefined
		},
		{
			name: "encode of an asset with a native track",
			mode: "encode",
			retranscribe: false,
			hint: undefined,
			stored: [es],
			expected: undefined
		},
		{
			name: "reencode of an asset with a native track",
			mode: "reencode",
			retranscribe: false,
			hint: undefined,
			stored: [es],
			expected: undefined
		},
		{
			name: "post-process with no stored transcripts",
			mode: "postProcess",
			retranscribe: false,
			hint: undefined,
			stored: [],
			expected: undefined
		},
		{
			name: "post-process with only translations stored",
			mode: "postProcess",
			retranscribe: false,
			hint: undefined,
			stored: [en],
			expected: undefined
		},
		{
			name: "post-process with two native tracks",
			mode: "postProcess",
			retranscribe: false,
			hint: undefined,
			stored: [es, fr],
			expected: undefined
		}
	])("$name", ({ mode, retranscribe, hint, stored, expected }) => {
		expect(reusableNative({ mode: mode as "postProcess", retranscribe, hint, stored })).toBe(expected);
	});
});
