import { encodingPresets, type EncodingPreset } from "../models";
import { versionConflict } from "./versionConflict";

export async function savePreset(preset: EncodingPreset, expectedVersion: number): Promise<void> {
	const result = await encodingPresets().replaceOne({ _id: preset._id, version: expectedVersion }, preset);
	if (result.matchedCount === 0) {
		throw versionConflict(preset.name, expectedVersion);
	}
}
