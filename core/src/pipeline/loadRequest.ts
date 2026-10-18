import { NotFoundError } from "@helios/contracts";
import { requests, type PipelineRequest } from "../models";

export async function loadRequest(requestId: string): Promise<PipelineRequest> {
	const request = await requests().findOne({ _id: requestId });
	if (request === null) {
		throw new Error(`Request ${requestId} not found`);
	}
	return request;
}

export async function loadAccountRequest(accountId: string, requestId: string): Promise<PipelineRequest> {
	const request = await requests().findOne({ _id: requestId, accountId });
	if (request === null) {
		throw new NotFoundError(`Request ${requestId} not found`);
	}
	return request;
}
