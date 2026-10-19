import { randomUUID } from "node:crypto";

/**
 * Adds a `requestId` idempotency key to a create body when the caller did not supply one.
 *
 * The key is generated once per call, so every retry of that call sends the same key and the API returns the original
 * request instead of creating a duplicate.
 *
 * @param body The create body, which may already carry a `requestId`.
 * @returns The body with a `requestId` set.
 */
export function withIdempotencyKey<T extends { requestId?: string }>(body: T): T & { requestId: string } {
	return { ...body, requestId: body.requestId ?? randomUUID() };
}
