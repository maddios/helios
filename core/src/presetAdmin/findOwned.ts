import { ForbiddenError, NotFoundError } from "@helios/contracts";
import { encodingPresets, type EncodingPreset } from "../models";

export async function findOwned(owner: string | null, name: string): Promise<EncodingPreset> {
	const preset = await encodingPresets().findOne({ accountId: owner, name });
	if (preset) {
		return preset;
	}
	if (owner !== null && (await encodingPresets().findOne({ accountId: null, name }))) {
		throw new ForbiddenError(`System preset "${name}" is read-only; clone it instead`);
	}
	throw new NotFoundError(`Preset "${name}" not found`);
}
