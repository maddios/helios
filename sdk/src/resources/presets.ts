import type {
	AddProfileRequest,
	ClonePresetRequest,
	CreatePresetRequest,
	DryRunRequest,
	DryRunResponse,
	PresetListResponse,
	PresetView,
	UpdatePresetRequest,
	UpdateProfileRequest
} from "@helios/contracts";
import type { Transport } from "../transport/transport.js";

/**
 * Manages account presets: named sets of encoding profiles that encode requests refer to by name.
 *
 * Presets are versioned. Writes that change a preset take the `expectedVersion` you last read, and fail with 409 when it
 * has changed since. System presets such as `generic` can be read and cloned, but not edited.
 *
 * @example
 * const bella = await helios.presets.clone("generic", "bella");
 * await helios.presets.update("bella", { expectedVersion: bella.version, description: "Kodak sources" });
 */
export class Presets {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Lists presets visible to the account, including system presets.
	 *
	 * @returns The presets, each tagged `account` or `system`.
	 * @example
	 * const { presets } = await helios.presets.list();
	 */
	list(): Promise<PresetListResponse> {
		return this.transport.json<PresetListResponse>({ method: "GET", retry: "idempotent", path: "/presets" });
	}

	/**
	 * Gets a preset by name.
	 *
	 * @param name Preset name.
	 * @returns The preset, with its profiles and version.
	 * @throws {NotFoundError} When no visible preset has this name (404).
	 * @example
	 * const preset = await helios.presets.get("generic");
	 */
	get(name: string): Promise<PresetView> {
		return this.transport.json<PresetView>({ method: "GET", retry: "idempotent", path: presetPath(name) });
	}

	/**
	 * Creates an account preset with at least one profile.
	 *
	 * @param body Name, description, profiles and default post-processing. The server sets each profile's version to 1.
	 * @returns The created preset at version 1.
	 * @throws {ValidationError} When the profiles are invalid (400).
	 * @throws {ConflictError} When a preset with this name already exists (409).
	 * @example
	 * await helios.presets.create({ name: "bella", description, postProcess, profiles });
	 */
	create(body: CreatePresetRequest): Promise<PresetView> {
		return this.transport.json<PresetView>({ method: "POST", retry: "rateLimitOnly", path: "/presets", body });
	}

	/**
	 * Updates a preset's description or default post-processing. Bumps the preset version.
	 *
	 * @param name Preset name.
	 * @param body `expectedVersion` you last read, and the fields to change.
	 * @returns The updated preset.
	 * @throws {ConflictError} When `expectedVersion` is stale (409, `preset_version_conflict`).
	 * @throws {PermissionError} When the preset is a system preset (403).
	 * @example
	 * await helios.presets.update("bella", { expectedVersion: 2, postProcess: { transcribe: true, sceneDetection: false } });
	 */
	update(name: string, body: UpdatePresetRequest): Promise<PresetView> {
		return this.transport.json<PresetView>({ method: "PATCH", retry: "rateLimitOnly", path: presetPath(name), body });
	}

	/**
	 * Deletes an account preset.
	 *
	 * @param name Preset name.
	 * @param expectedVersion Preset version you last read.
	 * @returns Resolves when the preset is deleted (HTTP 204).
	 * @throws {ConflictError} When `expectedVersion` is stale (409).
	 * @throws {PermissionError} When the preset is a system preset (403).
	 * @example
	 * await helios.presets.delete("bella", 3);
	 */
	delete(name: string, expectedVersion: number): Promise<void> {
		return this.transport.json<void>({
			method: "DELETE",
			retry: "idempotent",
			path: presetPath(name),
			query: { expectedVersion }
		});
	}

	/**
	 * Adds a profile to an account preset. Bumps the preset version.
	 *
	 * @param name Preset name.
	 * @param body `expectedVersion` you last read, and the new profile.
	 * @returns The updated preset.
	 * @throws {ConflictError} When `expectedVersion` is stale or a profile with this name exists (409).
	 * @example
	 * await helios.presets.addProfile("bella", { expectedVersion: 1, profile });
	 */
	addProfile(name: string, body: AddProfileRequest): Promise<PresetView> {
		return this.transport.json<PresetView>({
			method: "POST",
			retry: "rateLimitOnly",
			path: `${presetPath(name)}/profiles`,
			body
		});
	}

	/**
	 * Updates one profile of an account preset. Bumps the preset and profile versions.
	 *
	 * Parameter changes are merged into the existing params and then validated by the server.
	 *
	 * @param name Preset name.
	 * @param profile Profile name.
	 * @param body `expectedVersion` you last read, and the fields to change.
	 * @returns The updated preset.
	 * @throws {ConflictError} When `expectedVersion` is stale (409).
	 * @throws {ValidationError} When the merged params are invalid (400).
	 * @example
	 * await helios.presets.updateProfile("bella", "720p", { expectedVersion: 2, priority: 5 });
	 */
	updateProfile(name: string, profile: string, body: UpdateProfileRequest): Promise<PresetView> {
		return this.transport.json<PresetView>({
			method: "PATCH",
			retry: "rateLimitOnly",
			path: profilePath(name, profile),
			body
		});
	}

	/**
	 * Removes a profile from an account preset. Bumps the preset version.
	 *
	 * @param name Preset name.
	 * @param profile Profile name.
	 * @param expectedVersion Preset version you last read.
	 * @returns The updated preset.
	 * @throws {ConflictError} When `expectedVersion` is stale (409).
	 * @example
	 * await helios.presets.removeProfile("bella", "720p", 3);
	 */
	removeProfile(name: string, profile: string, expectedVersion: number): Promise<PresetView> {
		return this.transport.json<PresetView>({
			method: "DELETE",
			retry: "idempotent",
			path: profilePath(name, profile),
			query: { expectedVersion }
		});
	}

	/**
	 * Copies a preset, system or account, into a new account preset.
	 *
	 * @param name Name of the preset to copy.
	 * @param newName Name of the new account preset.
	 * @returns The new preset at version 1.
	 * @throws {NotFoundError} When the source preset does not exist (404).
	 * @throws {ConflictError} When `newName` is already taken (409).
	 * @example
	 * const bella = await helios.presets.clone("generic", "bella");
	 */
	clone(name: string, newName: string): Promise<PresetView> {
		const body: ClonePresetRequest = { name: newName };
		return this.transport.json<PresetView>({
			method: "POST",
			retry: "rateLimitOnly",
			path: `${presetPath(name)}/clone`,
			body
		});
	}

	/**
	 * Plans the items a preset would create for a source, without writing anything.
	 *
	 * Provide exactly one of `assetId` (plan against an existing asset) or `sourceMetadata`.
	 *
	 * @param name Preset name.
	 * @param body The asset or source metadata to plan against, and optional post-processing.
	 * @returns The planned items with their queues and dependencies.
	 * @throws {ValidationError} When neither or both of `assetId` and `sourceMetadata` are given (400).
	 * @throws {NotFoundError} When the preset or the asset does not exist (404).
	 * @example
	 * const plan = await helios.presets.dryRun("bella", { sourceMetadata });
	 */
	dryRun(name: string, body: DryRunRequest): Promise<DryRunResponse> {
		return this.transport.json<DryRunResponse>({
			method: "POST",
			retry: "rateLimitOnly",
			path: `${presetPath(name)}/dry-run`,
			body
		});
	}
}

function presetPath(name: string): string {
	return `/presets/${encodeURIComponent(name)}`;
}

function profilePath(name: string, profile: string): string {
	return `${presetPath(name)}/profiles/${encodeURIComponent(profile)}`;
}
