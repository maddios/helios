import type { Destination } from "@helios/contracts";
import type { Account, PipelineRequest } from "../models";

export function resolveDestination(request: PipelineRequest, account: Account): Destination | undefined {
	return request.destination ?? account.destination;
}
