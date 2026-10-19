import type {
	ActiveStillResponse,
	AssetDeletedResponse,
	AssetListQuery,
	AssetListResponse,
	AssetScenesResponse,
	AssetTranscriptsResponse,
	AssetView,
	RequestView
} from "@helios/contracts";
import { withIdempotencyKey } from "../idempotency.js";
import type { Transport } from "../transport/transport.js";
import type { AssetPostProcessRequest } from "../types.js";

/**
 * Reads and manages assets: their outputs, transcripts, scenes, selected still and purge.
 *
 * @example
 * const asset = await helios.assets.get(assetId);
 * console.log(asset.outputs.generic?.items);
 */
export class Assets {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Lists assets, newest first, optionally filtered by `externalId`.
	 *
	 * @param query Page size (`limit`, 1 to 100), `cursor` from the previous page, and `externalId`.
	 * @returns A page of assets and the `nextCursor` when more exist.
	 * @example
	 * const page = await helios.assets.list({ externalId: "clip-42", limit: 10 });
	 */
	list(query: AssetListQuery = {}): Promise<AssetListResponse> {
		return this.transport.json<AssetListResponse>({ method: "GET", retry: "idempotent", path: "/assets", query });
	}

	/**
	 * Gets an asset with its outputs and CDN urls.
	 *
	 * @param id Asset id.
	 * @returns The asset.
	 * @throws {NotFoundError} When the asset does not exist for this account (404).
	 * @example
	 * const asset = await helios.assets.get("a1b2");
	 */
	get(id: string): Promise<AssetView> {
		return this.transport.json<AssetView>({ method: "GET", retry: "idempotent", path: assetPath(id) });
	}

	/**
	 * Deletes an asset and purges its outputs. The purge runs asynchronously; an `asset.deleted` event follows.
	 *
	 * @param id Asset id.
	 * @returns The accepted purge, with the asset id.
	 * @throws {NotFoundError} When the asset does not exist for this account (404).
	 * @example
	 * await helios.assets.delete(asset.id);
	 */
	delete(id: string): Promise<AssetDeletedResponse> {
		return this.transport.json<AssetDeletedResponse>({ method: "DELETE", retry: "idempotent", path: assetPath(id) });
	}

	/**
	 * Lists the transcripts of an asset, with CDN urls for each file.
	 *
	 * @param id Asset id.
	 * @returns The transcripts.
	 * @throws {NotFoundError} When the asset does not exist for this account (404).
	 * @example
	 * const { transcripts } = await helios.assets.transcripts(asset.id);
	 */
	transcripts(id: string): Promise<AssetTranscriptsResponse> {
		return this.transport.json<AssetTranscriptsResponse>({
			method: "GET",
			retry: "idempotent",
			path: `${assetPath(id)}/transcripts`
		});
	}

	/**
	 * Gets the latest scene analysis of an asset.
	 *
	 * @param id Asset id.
	 * @returns The summary and the scenes with representative stills.
	 * @throws {NotFoundError} When the asset does not exist for this account (404).
	 * @throws {ConflictError} When scene detection has not completed (409).
	 * @example
	 * const { scenes } = await helios.assets.scenes(asset.id);
	 */
	scenes(id: string): Promise<AssetScenesResponse> {
		return this.transport.json<AssetScenesResponse>({
			method: "GET",
			retry: "idempotent",
			path: `${assetPath(id)}/scenes`
		});
	}

	/**
	 * Selects the still image shown as the asset's thumbnail.
	 *
	 * @param id Asset id.
	 * @param index Index of the still within the stills output.
	 * @returns The selected still.
	 * @throws {ValidationError} When `index` is negative (400).
	 * @throws {ConflictError} When the asset has no stills (409).
	 * @example
	 * await helios.assets.setActiveStill(asset.id, 3);
	 */
	setActiveStill(id: string, index: number): Promise<ActiveStillResponse> {
		return this.transport.json<ActiveStillResponse>({
			method: "PATCH",
			retry: "rateLimitOnly",
			path: `${assetPath(id)}/active-still`,
			body: { index }
		});
	}

	/**
	 * Runs post-processing (transcription, translations, scene detection) on an existing asset.
	 *
	 * @param id Asset id.
	 * @param request Post-processing options and an optional `requestId`.
	 * @returns The accepted request (HTTP 202).
	 * @throws {ConflictError} When another request is in progress for the asset (409).
	 * @throws {UnprocessableError} When the options cannot be applied to the asset (422).
	 * @example
	 * await helios.assets.postProcess(asset.id, { postProcess: { transcribe: { translations: ["de"] } } });
	 */
	postProcess(id: string, request: AssetPostProcessRequest): Promise<RequestView> {
		return this.transport.json<RequestView>({
			method: "POST",
			path: `${assetPath(id)}/post-process`,
			body: withIdempotencyKey(request),
			retry: "idempotent"
		});
	}
}

function assetPath(id: string): string {
	return `/assets/${encodeURIComponent(id)}`;
}
