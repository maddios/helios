import type { FetchFn } from "../../src/options.js";
import { clientWith } from "./client.js";

/**
 * Builds the uploads resource on a client with an injected fetch.
 *
 * @param fetch The fetch stub.
 * @returns The uploads resource.
 */
export function uploadsFor(fetch: FetchFn) {
	return clientWith(fetch).uploads;
}
