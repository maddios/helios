import type { RequestStatus, RequestView } from "../../src/types.js";

/**
 * A request view in the given status.
 *
 * @param status Request status.
 * @param id Request id.
 * @returns The request.
 */
export function requestView(status: RequestStatus, id = "r1"): RequestView {
	return {
		id,
		assetId: "a1",
		mode: "encode",
		status,
		assetVersion: 1,
		items: [],
		progress: { total: 0, finished: 0, pending: 0 },
		createdAt: "2026-10-19T00:00:00.000Z"
	};
}
