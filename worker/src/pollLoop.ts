import type { QueueName } from "@helios/contracts";
import { contextLogger, queueFor, type ItemMessage, type Queue, type ReceivedMessage } from "@helios/core";
import { setTimeout as sleep } from "node:timers/promises";
import { config } from "./config";
import { processItem, type ItemOutcome } from "./processItem";

export const WORKER_QUEUES: QueueName[] = ["fargate-p1", "fargate-p2", "fargate-p3", "fargate-p4"];
export const LONG_POLL_SEC = 5;
export const POLL_ERROR_BACKOFF_MS = 1000;

export interface PollStep {
	queue: QueueName;
	waitSec: number;
}

export function pollSequence(queues: readonly QueueName[]): PollStep[] {
	const [first] = queues;
	if (first === undefined) {
		throw new Error("At least one queue is required to poll");
	}
	return [...queues.map((queue) => ({ queue, waitSec: 0 })), { queue: first, waitSec: LONG_POLL_SEC }];
}

export interface RunWorkerOptions {
	signal?: AbortSignal;
}

export async function runWorker({ signal = new AbortController().signal }: RunWorkerOptions = {}): Promise<void> {
	const { IDLE_EXIT, WORKER_IDLE_TIMEOUT_SEC } = config();
	let lastActivityAt = Date.now();
	while (!signal.aborted) {
		if (await pollRound(signal)) {
			lastActivityAt = Date.now();
		} else if (IDLE_EXIT && Date.now() - lastActivityAt >= WORKER_IDLE_TIMEOUT_SEC * 1000) {
			return;
		}
	}
}

async function pollRound(signal: AbortSignal): Promise<boolean> {
	try {
		return await pollOnce(signal);
	} catch (err) {
		if (!signal.aborted) {
			contextLogger({}).error({ err }, "Poll round failed; backing off and retrying");
			await sleep(POLL_ERROR_BACKOFF_MS);
		}
		return false;
	}
}

async function pollOnce(signal: AbortSignal): Promise<boolean> {
	for (const step of pollSequence(WORKER_QUEUES)) {
		if (signal.aborted) {
			return false;
		}
		const queue = queueFor<ItemMessage>(step.queue);
		const [message] = await queue.poll(1, step.waitSec, undefined, signal);
		if (message !== undefined) {
			await processMessage(queue, message, signal);
			return true;
		}
	}
	return false;
}

export async function processMessage(
	queue: Queue<ItemMessage>,
	message: ReceivedMessage<ItemMessage>,
	signal: AbortSignal
): Promise<void> {
	const outcome = await runItem(queue, message, signal);
	if (outcome === "done") {
		await queue.ack(message);
	} else if (outcome === "interrupted") {
		await requeue(queue, message);
	}
}

async function runItem(
	queue: Queue<ItemMessage>,
	message: ReceivedMessage<ItemMessage>,
	signal: AbortSignal
): Promise<ItemOutcome> {
	try {
		return await processItem({
			itemId: message.body.itemId,
			messageId: message.id,
			extendVisibility: (seconds) => queue.changeVisibility(message, seconds),
			signal
		});
	} catch (err) {
		contextLogger({ itemId: message.body.itemId }).error(
			{ err },
			"Item processing failed; message left for redelivery"
		);
		return "redeliver";
	}
}

async function requeue(queue: Queue<ItemMessage>, message: ReceivedMessage<ItemMessage>): Promise<void> {
	await queue.send({ body: message.body, groupId: message.groupId, attributes: message.attributes });
	await queue.ack(message);
}
