import { Helios } from "../../src/client.js";
import type { FetchFn, HeliosOptions } from "../../src/options.js";

/**
 * Builds a client with fast retries and an injected fetch.
 *
 * @param fetch The fetch stub.
 * @param overrides Options to add or replace.
 * @returns The client.
 */
export function clientWith(fetch: FetchFn, overrides: Partial<HeliosOptions> = {}): Helios {
	return new Helios({
		apiKey: "sk_live_test",
		baseUrl: "https://api.test",
		retryBaseDelayMs: 1,
		fetch,
		...overrides
	});
}
