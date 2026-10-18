import { NotFoundError } from "@helios/contracts";
import { encodingPresets, type EncodingPreset } from "../models";

export async function resolvePreset(accountId: string, name: string): Promise<EncodingPreset> {
	const preset =
		(await encodingPresets().findOne({ accountId, name })) ??
		(await encodingPresets().findOne({ accountId: null, name }));
	if (!preset) {
		throw new NotFoundError(`Preset "${name}" not found`);
	}
	return preset;
}
