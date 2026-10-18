import type { Preset } from "@helios/contracts";
import { encodingPresets } from "../models";
import { insertPreset } from "./insertPreset";
import { savePreset } from "./savePreset";

export async function seedSystemPreset(preset: Preset): Promise<"inserted" | "replaced" | "unchanged"> {
	const existing = await encodingPresets().findOne({ accountId: null, name: preset.name });
	if (!existing) {
		await insertPreset(null, preset);
		return "inserted";
	}
	if (existing.version >= preset.version) {
		return "unchanged";
	}
	await savePreset({ ...existing, ...preset, updatedAt: new Date() }, existing.version);
	return "replaced";
}
