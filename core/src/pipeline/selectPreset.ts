import type { Preset, RequestMode } from "@helios/contracts";

export interface SelectPresetInput {
	mode: RequestMode;
	current: Preset;
	snapshot?: Preset;
	refreshPreset?: boolean;
}

export function selectPreset({ mode, current, snapshot, refreshPreset }: SelectPresetInput): Preset {
	if (mode === "encode") {
		return current;
	}
	if (mode === "reencode" && refreshPreset) {
		return current;
	}
	if (snapshot === undefined) {
		throw new Error(`A preset snapshot is required for mode "${mode}"`);
	}
	return snapshot;
}
