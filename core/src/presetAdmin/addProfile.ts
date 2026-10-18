import type { AddProfileRequest } from "@helios/contracts";
import type { EncodingPreset } from "../models";
import { editPreset } from "./editPreset";

export async function addProfile(
	owner: string | null,
	name: string,
	input: AddProfileRequest
): Promise<EncodingPreset> {
	return editPreset(owner, name, input.expectedVersion, (current) => ({
		...current,
		profiles: [...current.profiles, { ...input.profile, version: 1 }]
	}));
}
