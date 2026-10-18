import { randomUUID } from "node:crypto";
import { ConflictError, type Preset } from "@helios/contracts";
import { isDuplicateKeyError } from "../db";
import { encodingPresets, type EncodingPreset } from "../models";

export async function insertPreset(owner: string | null, preset: Preset): Promise<EncodingPreset> {
	const now = new Date();
	const record: EncodingPreset = { ...preset, _id: randomUUID(), accountId: owner, createdAt: now, updatedAt: now };
	try {
		await encodingPresets().insertOne(record);
	} catch (err) {
		if (isDuplicateKeyError(err)) {
			throw new ConflictError(`Preset "${preset.name}" already exists`);
		}
		throw err;
	}
	return record;
}
