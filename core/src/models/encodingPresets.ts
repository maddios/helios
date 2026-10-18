import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { PresetSchema } from "@helios/contracts";
import { db } from "../db";

export const EncodingPresetSchema = PresetSchema.extend({
	_id: z.string(),
	accountId: z.string().nullable(),
	updatedAt: z.date(),
	createdAt: z.date()
});
export type EncodingPreset = z.infer<typeof EncodingPresetSchema>;

export const encodingPresets = () => db().collection<EncodingPreset>("encoding_presets");

export const encodingPresetIndexes: IndexDescription[] = [{ key: { accountId: 1, name: 1 }, unique: true }];
