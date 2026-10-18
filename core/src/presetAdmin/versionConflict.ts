import { ConflictError } from "@helios/contracts";

export function versionConflict(name: string, expectedVersion: number): ConflictError {
	return new ConflictError(
		`Preset "${name}" is no longer at version ${expectedVersion}`,
		{ expectedVersion },
		"preset_version_conflict"
	);
}
