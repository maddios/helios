import { PresetSchema, ValidationError, type Preset } from "@helios/contracts";

export function validatePreset(candidate: unknown): Preset {
	const result = PresetSchema.safeParse(candidate);
	if (!result.success) {
		throw new ValidationError("Invalid preset", result.error.issues);
	}
	return result.data;
}
