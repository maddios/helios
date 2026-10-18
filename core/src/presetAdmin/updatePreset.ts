import type { UpdatePresetRequest } from "@helios/contracts";
import type { EncodingPreset } from "../models";
import { definedKeys } from "./definedKeys";
import { editPreset } from "./editPreset";

export async function updatePreset(
	owner: string | null,
	name: string,
	input: UpdatePresetRequest
): Promise<EncodingPreset> {
	const { expectedVersion, ...patch } = input;
	return editPreset(owner, name, expectedVersion, (current) => ({ ...current, ...definedKeys(patch) }));
}
