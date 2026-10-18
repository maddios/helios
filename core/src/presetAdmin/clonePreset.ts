import type { EncodingPreset } from "../models";
import { insertPreset } from "./insertPreset";
import { resolvePreset } from "./resolvePreset";

export async function clonePreset(accountId: string, sourceName: string, name: string): Promise<EncodingPreset> {
	const source = await resolvePreset(accountId, sourceName);
	return insertPreset(accountId, {
		name,
		version: 1,
		description: source.description,
		postProcess: source.postProcess,
		profiles: source.profiles
	});
}
