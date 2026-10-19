import { queueFor, requests, type ItemMessage } from "@helios/core";
import { processMessage } from "../../worker/src/pollLoop";

export const DRAIN_DEADLINE_MS = 180000;

export async function drainOnce(): Promise<void> {
	for (const name of ["lambda-p1", "lambda-ai", "fargate-p1", "fargate-p2", "fargate-p3", "fargate-p4"] as const) {
		const queue = queueFor<ItemMessage>(name);
		for (const message of await queue.poll(1, 1)) {
			await processMessage(queue, message, new AbortController().signal);
		}
	}
}

export async function drainUntilTerminal(requestIds: string[]): Promise<void> {
	const deadline = Date.now() + DRAIN_DEADLINE_MS;
	while (Date.now() < deadline) {
		const open = await requests().countDocuments({
			_id: { $in: requestIds },
			status: { $in: ["ANALYZING", "IN_PROGRESS"] }
		});
		if (open === 0) {
			return;
		}
		await drainOnce();
	}
	throw new Error(`Requests ${requestIds.join(", ")} did not finish within ${DRAIN_DEADLINE_MS} ms`);
}
