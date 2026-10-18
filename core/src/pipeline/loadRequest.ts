import { requests, type PipelineRequest } from "../models";

export async function loadRequest(requestId: string): Promise<PipelineRequest> {
	const request = await requests().findOne({ _id: requestId });
	if (request === null) {
		throw new Error(`Request ${requestId} not found`);
	}
	return request;
}
