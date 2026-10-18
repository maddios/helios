import type { CreatePresetRequest } from "@helios/contracts";
import type { EncodingPreset } from "../models";
import { insertPreset } from "./insertPreset";
import { validatePreset } from "./validatePreset";

export async function createPreset(owner: string | null, input: CreatePresetRequest): Promise<EncodingPreset> {
	const profiles = input.profiles.map((profile) => ({ ...profile, version: 1 }));
	return insertPreset(owner, validatePreset({ ...input, profiles, version: 1 }));
}
