import type { CreatePresetRequest, PresetListResponse, PresetView, UpdatePresetRequest } from "@helios/contracts";
import type { Transport } from "../transport/transport.js";

/**
 * Manages system presets, which every account can read and clone.
 *
 * @example
 * const { presets } = await admin.presets.list();
 */
export class AdminPresets {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Lists system presets.
	 *
	 * @returns The system presets.
	 * @example
	 * const { presets } = await admin.presets.list();
	 */
	list(): Promise<PresetListResponse> {
		return this.transport.json<PresetListResponse>({ method: "GET", retry: "idempotent", path: "/admin/presets" });
	}

	/**
	 * Gets a system preset.
	 *
	 * @param name Preset name.
	 * @returns The preset.
	 * @throws {NotFoundError} When no system preset has this name (404).
	 * @example
	 * const generic = await admin.presets.get("generic");
	 */
	get(name: string): Promise<PresetView> {
		return this.transport.json<PresetView>({ method: "GET", retry: "idempotent", path: presetPath(name) });
	}

	/**
	 * Creates a system preset.
	 *
	 * @param body Name, description, profiles and default post-processing.
	 * @returns The preset at version 1.
	 * @throws {ConflictError} When the name is taken (409).
	 * @throws {ValidationError} When the profiles are invalid (400).
	 * @example
	 * await admin.presets.create({ name: "social", description: "Social cuts", postProcess, profiles });
	 */
	create(body: CreatePresetRequest): Promise<PresetView> {
		return this.transport.json<PresetView>({ method: "POST", retry: "rateLimitOnly", path: "/admin/presets", body });
	}

	/**
	 * Updates a system preset. Bumps its version.
	 *
	 * @param name Preset name.
	 * @param body The `expectedVersion` you last read, and the fields to change.
	 * @returns The updated preset.
	 * @throws {ConflictError} When `expectedVersion` is stale (409).
	 * @throws {NotFoundError} When no system preset has this name (404).
	 * @example
	 * await admin.presets.update("social", { expectedVersion: 1, description: "Updated" });
	 */
	update(name: string, body: UpdatePresetRequest): Promise<PresetView> {
		return this.transport.json<PresetView>({ method: "PATCH", retry: "rateLimitOnly", path: presetPath(name), body });
	}

	/**
	 * Deletes a system preset.
	 *
	 * @param name Preset name.
	 * @param expectedVersion Preset version you last read.
	 * @returns Resolves when the preset is deleted (HTTP 204).
	 * @throws {ConflictError} When `expectedVersion` is stale (409).
	 * @example
	 * await admin.presets.delete("social", 2);
	 */
	delete(name: string, expectedVersion: number): Promise<void> {
		return this.transport.json<void>({
			method: "DELETE",
			retry: "idempotent",
			path: presetPath(name),
			query: { expectedVersion }
		});
	}
}

function presetPath(name: string): string {
	return `/admin/presets/${encodeURIComponent(name)}`;
}
