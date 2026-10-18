import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError, TooManyRequestsError } from "@helios/contracts";
import { requests } from "../models";
import { isOpenRequest, sendCallback } from "../pipeline";

const MS_PER_SEC = 1000;

export async function redeliver(accountId: string, requestId: string, cooldownSec: number): Promise<void> {
	const request = await requests().findOne({ _id: requestId, accountId });
	if (request === null) {
		throw new NotFoundError("Request not found");
	}
	if (isOpenRequest(request.status)) {
		throw new ConflictError("Request is still in progress");
	}
	const now = new Date();
	const cutoff = new Date(now.getTime() - cooldownSec * MS_PER_SEC);
	const claimed = await requests().updateOne(
		{
			_id: requestId,
			accountId,
			$or: [{ lastRedeliverAt: { $exists: false } }, { lastRedeliverAt: { $lte: cutoff } }]
		},
		{ $set: { lastRedeliverAt: now } }
	);
	if (claimed.matchedCount === 0) {
		throw await cooldownError(requestId, cooldownSec, now);
	}
	await sendCallback({ type: "request", requestId }, randomUUID());
}

async function cooldownError(requestId: string, cooldownSec: number, now: Date): Promise<TooManyRequestsError> {
	const latest = await requests().findOne({ _id: requestId });
	const readyAt = (latest?.lastRedeliverAt?.getTime() ?? now.getTime()) + cooldownSec * MS_PER_SEC;
	return new TooManyRequestsError(
		"redeliver_cooldown",
		"A callback was redelivered recently; try again later",
		Math.ceil((readyAt - now.getTime()) / MS_PER_SEC)
	);
}
