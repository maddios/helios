import type { EncodingProfile, StillsProfile } from "@helios/contracts";
import type { PipelineItem, PipelineRequest } from "@helios/core";

export interface ResolvedProfiles {
	profile: EncodingProfile;
	children: StillsProfile[];
}

export function resolveProfiles(request: PipelineRequest, item: PipelineItem): ResolvedProfiles {
	const { profiles } = request.presetSnapshot;
	const profile = profiles.find((candidate) => candidate.name === item.profile);
	if (profile === undefined) {
		throw new Error(`Profile ${item.profile} is not in the preset snapshot of request ${request._id}`);
	}
	const children = profile.children.map((name) => {
		const child = profiles.find((candidate) => candidate.name === name);
		if (child === undefined || child.type !== "stills") {
			throw new Error(`Child ${name} of ${profile.name} must be a stills profile`);
		}
		return child;
	});
	return { profile, children };
}
