import { ValidationError, type ExpectedVersionQuery } from "@helios/contracts";
import type { EncodingPreset } from "../models";
import { editPreset } from "./editPreset";
import { findProfile } from "./findProfile";

export async function removeProfile(
	owner: string | null,
	name: string,
	profileName: string,
	input: ExpectedVersionQuery
): Promise<EncodingPreset> {
	return editPreset(owner, name, input.expectedVersion, (current) => {
		const profile = findProfile(current, profileName);
		if (profile.isDefault) {
			throw new ValidationError(`Profile "${profileName}" is the default and cannot be removed`);
		}
		if (current.profiles.some((candidate) => candidate.children.includes(profileName))) {
			throw new ValidationError(`Profile "${profileName}" is a child of another profile and cannot be removed`);
		}
		return { ...current, profiles: current.profiles.filter((candidate) => candidate.name !== profileName) };
	});
}
