import { NotFoundError } from "@helios/contracts";
import type { EncodingPreset } from "../models";

export function findProfile(preset: EncodingPreset, profileName: string): EncodingPreset["profiles"][number] {
	const profile = preset.profiles.find((candidate) => candidate.name === profileName);
	if (!profile) {
		throw new NotFoundError(`Profile "${profileName}" not found`);
	}
	return profile;
}
