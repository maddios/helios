import { ConfigurationError } from "./errors.js";
import { integerIn } from "./validation.js";

/** The `fetch` signature the SDK calls; the global `fetch` unless overridden. */
export type FetchFn = typeof fetch;

/**
 * Options shared by every client entry point. Every value is passed explicitly; the SDK reads no environment variables.
 *
 * @example
 * const options: TransportOptions = { apiKey: "sk_live_...", baseUrl: "https://helios.example.com" };
 */
export interface TransportOptions {
	/** Secret API key (`sk_live_...` for accounts, `sk_admin_...` for admin). Required. */
	apiKey: string;
	/** Origin of the Helios API, e.g. `https://helios.example.com`. Required; `http` or `https` only. */
	baseUrl: string;
	/** Timeout of each HTTP attempt, in milliseconds, from 1 to 3600000. Defaults to 30000. */
	timeoutMs?: number;
	/** Retries after the first attempt, from 0 to 10. Applies to 429, and to 5xx, network errors and timeouts on idempotent requests. Defaults to 3. */
	maxRetries?: number;
	/** Base delay of the exponential backoff between retries, in milliseconds, from 0 to 60000. Defaults to 250. */
	retryBaseDelayMs?: number;
	/**
	 * Longest `Retry-After` the SDK waits for, in milliseconds, from 0 to 3600000. A longer one throws the error at once,
	 * with its `retryAfterMs`. Defaults to 30000.
	 */
	maxRetryAfterMs?: number;
	/** Replacement for the global `fetch`, e.g. for tests or a proxy. */
	fetch?: FetchFn;
}

/**
 * Options of the account client, {@link Helios}.
 *
 * @example
 * const helios = new Helios({ apiKey, baseUrl, imageBaseUrl: "https://img.example.com", webhookSecret });
 */
export interface HeliosOptions extends TransportOptions {
	/** Origin that serves transformed images, required only by `images.url`. */
	imageBaseUrl?: string;
	/** Secret used by `webhooks.verify` when it is not passed per call. Must not be empty. */
	webhookSecret?: string;
}

/** Validated transport settings with defaults applied. */
export interface TransportSettings {
	apiKey: string;
	baseUrl: string;
	timeoutMs: number;
	maxRetries: number;
	retryBaseDelayMs: number;
	maxRetryAfterMs: number;
	fetch: FetchFn;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;
const MAX_TIMEOUT_MS = 3_600_000;

/**
 * Validates the options and applies defaults.
 *
 * @param options The caller's options.
 * @returns The settings used by the transport.
 * @throws {ConfigurationError} When `apiKey` is empty, `baseUrl` is not an http(s) URL, or a number is out of range.
 */
export function resolveSettings(options: TransportOptions): TransportSettings {
	if (options.apiKey.trim() === "") {
		throw new ConfigurationError("configuration_error", "apiKey is required");
	}
	return {
		apiKey: options.apiKey,
		baseUrl: normalizeBaseUrl(options.baseUrl),
		timeoutMs: integerIn("timeoutMs", options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS),
		maxRetries: integerIn("maxRetries", options.maxRetries ?? DEFAULT_MAX_RETRIES, 0, 10),
		retryBaseDelayMs: integerIn("retryBaseDelayMs", options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS, 0, 60_000),
		maxRetryAfterMs: integerIn(
			"maxRetryAfterMs",
			options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS,
			0,
			MAX_TIMEOUT_MS
		),
		fetch: options.fetch ?? fetch
	};
}

function normalizeBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new ConfigurationError("configuration_error", `baseUrl "${value}" is not a valid URL`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new ConfigurationError("configuration_error", "baseUrl must use http or https");
	}
	return value.replace(/\/+$/, "");
}
