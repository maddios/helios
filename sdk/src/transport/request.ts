/** Query-string values; `undefined` entries are omitted from the URL. */
export type QueryValue = string | number | boolean | undefined;

/**
 * Builds an absolute request URL.
 *
 * @param baseUrl Normalised base URL without a trailing slash.
 * @param path Path beginning with `/`.
 * @param query Optional query parameters.
 * @returns The full URL.
 */
export function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
	const search = new URLSearchParams();
	for (const [name, value] of Object.entries(query ?? {})) {
		if (value !== undefined) {
			search.set(name, String(value));
		}
	}
	const suffix = search.size > 0 ? `?${search.toString()}` : "";
	return `${baseUrl}${path}${suffix}`;
}

/**
 * Parses an error body, returning `undefined` when it is empty or not JSON. Error responses are mapped by status either way.
 *
 * @param text The raw body text.
 * @returns The parsed value, or `undefined`.
 */
export function parseErrorBody(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
