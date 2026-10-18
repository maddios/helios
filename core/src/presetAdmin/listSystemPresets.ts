import { encodingPresets, type EncodingPreset } from "../models";

export async function listSystemPresets(): Promise<EncodingPreset[]> {
	return encodingPresets().find({ accountId: null }).sort({ name: 1 }).toArray();
}
