import type { EncodingPreset } from "../models";
import { findOwned } from "./findOwned";
import { savePreset } from "./savePreset";
import { validatePreset } from "./validatePreset";
import { versionConflict } from "./versionConflict";

export async function editPreset(
	owner: string | null,
	name: string,
	expectedVersion: number,
	edit: (current: EncodingPreset) => Record<string, unknown>
): Promise<EncodingPreset> {
	const current = await findOwned(owner, name);
	if (current.version !== expectedVersion) {
		throw versionConflict(name, expectedVersion);
	}
	const validated = validatePreset({ ...edit(current), version: current.version + 1 });
	const updated: EncodingPreset = { ...current, ...validated, updatedAt: new Date() };
	await savePreset(updated, expectedVersion);
	return updated;
}
