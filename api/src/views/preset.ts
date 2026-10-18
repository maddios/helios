import type { PresetView } from "@helios/contracts";
import type { EncodingPreset } from "@helios/core";

export function toPresetView(preset: EncodingPreset): PresetView {
	const { name, version, description, profiles, postProcess, accountId } = preset;
	return { name, version, description, profiles, postProcess, scope: accountId === null ? "system" : "account" };
}
