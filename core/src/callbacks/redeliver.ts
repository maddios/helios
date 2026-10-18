import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError } from "@helios/contracts";
import { requests } from "../models";
import { isOpenRequest, sendCallback } from "../pipeline";

export async function redeliver(accountId: string, requestId: string): Promise<void> {
	const request = await requests().findOne({ _id: requestId, accountId });
	if (request === null) {
		throw new NotFoundError("Request not found");
	}
	if (isOpenRequest(request.status)) {
		throw new ConflictError("Request is still in progress");
	}
	await sendCallback({ type: "request", requestId }, randomUUID());
}
