import type { HealthResponse, ReadyResponse } from "@helios/contracts";
import { Images } from "./images.js";
import { resolveSettings, type HeliosOptions } from "./options.js";
import { Transport } from "./transport/transport.js";
import { Account } from "./resources/account.js";
import { Assets } from "./resources/assets.js";
import { Destinations } from "./resources/destinations.js";
import { Encodes } from "./resources/encodes.js";
import { Files } from "./resources/files.js";
import { Presets } from "./resources/presets.js";
import { Requests } from "./resources/requests.js";
import { Uploads } from "./resources/uploads.js";
import { Usage } from "./resources/usage.js";
import { Webhooks } from "./webhooks.js";

/** An OpenAPI 3.0 document, as served at `/openapi.json`. */
export type OpenApiDocument = Record<string, unknown>;

/**
 * Client for the account-scoped Helios API.
 *
 * Each resource is a property: `encodes`, `assets`, `requests`, `uploads`, `files`, `presets`, `destinations`,
 * `account`, `usage`, plus the local helpers `webhooks` and `images`. Every method returns typed data or throws a
 * {@link HeliosError} subclass.
 *
 * @example
 * const helios = new Helios({ apiKey: "sk_live_...", baseUrl: "https://helios.example.com" });
 * const { file, request } = await helios.uploads.upload("./clip.mp4", { contentType: "video/mp4", encode: { preset: "generic" } });
 * const done = await helios.requests.wait(request.id);
 */
export class Helios {
	/** Starts encode requests and re-encodes. */
	readonly encodes: Encodes;
	/** Reads and manages assets. */
	readonly assets: Assets;
	/** Reads, cancels and waits for requests; includes callback deliveries. */
	readonly requests: Requests;
	/** Stores files: uploads, then keeps them or encodes them. */
	readonly uploads: Uploads;
	/** Lists, reads and deletes stored files, and stores files from a URL. */
	readonly files: Files;
	/** Manages account presets. */
	readonly presets: Presets;
	/** Tests destinations and prepares EventBridge buses. */
	readonly destinations: Destinations;
	/** Reads and sets the account's default delivery destination and upload policy. */
	readonly account: Account;
	/** Reads resource usage. */
	readonly usage: Usage;
	/** Verifies and parses signed webhook events. Performs no network calls. */
	readonly webhooks: Webhooks;
	/** Builds canonical image URLs. Performs no network calls. */
	readonly images: Images;

	private readonly transport: Transport;

	/**
	 * @param options API key, base URL and optional timeouts, retries, fetch, image base URL and webhook secret.
	 * @throws {ConfigurationError} When `apiKey` is empty or `baseUrl` is not an http(s) URL.
	 * @example
	 * const helios = new Helios({ apiKey, baseUrl, imageBaseUrl: "https://img.example.com", webhookSecret });
	 */
	constructor(options: HeliosOptions) {
		this.transport = new Transport(resolveSettings(options));
		this.encodes = new Encodes(this.transport);
		this.assets = new Assets(this.transport);
		this.requests = new Requests(this.transport);
		this.uploads = new Uploads(this.transport);
		this.files = new Files(this.transport);
		this.presets = new Presets(this.transport);
		this.destinations = new Destinations(this.transport);
		this.account = new Account(this.transport);
		this.usage = new Usage(this.transport);
		this.webhooks = new Webhooks(options.webhookSecret);
		this.images = new Images(options.imageBaseUrl);
	}

	/**
	 * Checks that the API process is alive. Does not touch the database.
	 *
	 * @returns `{ status: "ok" }`.
	 * @throws {ConnectionError} When the API cannot be reached.
	 * @example
	 * await helios.health();
	 */
	health(): Promise<HealthResponse> {
		return this.transport.json<HealthResponse>({ method: "GET", retry: "idempotent", path: "/health" });
	}

	/**
	 * Checks that the API can reach its database.
	 *
	 * @returns `{ status: "ready" }`.
	 * @throws {ServiceUnavailableError} When the database is unavailable (503).
	 * @example
	 * await helios.ready();
	 */
	ready(): Promise<ReadyResponse> {
		return this.transport.json<ReadyResponse>({ method: "GET", retry: "idempotent", path: "/ready" });
	}

	/**
	 * Gets the OpenAPI document that describes every endpoint.
	 *
	 * @returns The OpenAPI 3.0.3 document.
	 * @throws {AuthenticationError} When the key is invalid (401).
	 * @example
	 * const spec = await helios.openapi();
	 */
	openapi(): Promise<OpenApiDocument> {
		return this.transport.json<OpenApiDocument>({ method: "GET", retry: "idempotent", path: "/openapi.json" });
	}
}
