import type { UpdateProfileRequest } from "@helios/contracts";
import type { EncodingPreset } from "../models";
import { definedKeys } from "./definedKeys";
import { editPreset } from "./editPreset";
import { findProfile } from "./findProfile";

export async function updateProfile(
	owner: string | null,
	name: string,
	profileName: string,
	input: UpdateProfileRequest
): Promise<EncodingPreset> {
	const { expectedVersion, params, ...patch } = input;
	return editPreset(owner, name, expectedVersion, (current) => {
		const profile = findProfile(current, profileName);
		const nextProfile = {
			...profile,
			...definedKeys(patch),
			params: { ...profile.params, ...params },
			version: profile.version + 1
		};
		return {
			...current,
			profiles: current.profiles.map((candidate) => (candidate.name === profileName ? nextProfile : candidate))
		};
	});
}
