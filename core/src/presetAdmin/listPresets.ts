import { encodingPresets, type EncodingPreset } from "../models";

export async function listPresets(accountId: string): Promise<EncodingPreset[]> {
	const presets = await encodingPresets()
		.find({ accountId: { $in: [accountId, null] } })
		.sort({ name: 1 })
		.toArray();
	const ownNames = new Set(presets.filter((preset) => preset.accountId === accountId).map((preset) => preset.name));
	return presets.filter((preset) => preset.accountId === accountId || !ownNames.has(preset.name));
}
