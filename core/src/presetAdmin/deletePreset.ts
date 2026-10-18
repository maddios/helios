import type { ExpectedVersionQuery } from "@helios/contracts";
import { encodingPresets } from "../models";
import { findOwned } from "./findOwned";
import { versionConflict } from "./versionConflict";

export async function deletePreset(owner: string | null, name: string, input: ExpectedVersionQuery): Promise<void> {
	const preset = await findOwned(owner, name);
	const result = await encodingPresets().deleteOne({ _id: preset._id, version: input.expectedVersion });
	if (result.deletedCount === 0) {
		throw versionConflict(name, input.expectedVersion);
	}
}
