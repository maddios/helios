import type { QueueName } from "@helios/contracts";
import { contextLogger, FARGATE_QUEUE_NAMES, queueFor, type Queue, type ReceivedMessage } from "@helios/core";
import { setTimeout as sleep } from "node:timers/promises";
import { fargateConfig } from "./config";
import { runFileIngest, isFileIngest, type WorkerMessage } from "./fileIngest";
import { processItem, type ItemOutcome } from "./processItem";

export const WORKER_QUEUES = FARGATE_QUEUE_NAMES;
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
	const { IDLE_EXIT, WORKER_IDLE_TIMEOUT_SEC } = fargateConfig();
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
		const queue = queueFor<WorkerMessage>(step.queue);
		const [message] = await queue.poll(1, step.waitSec, undefined, signal);
		if (message !== undefined) {
			await processMessage(queue, message, signal);
			return true;
		}
	}
	return false;
}

export async function processMessage(
	queue: Queue<WorkerMessage>,
	message: ReceivedMessage<WorkerMessage>,
	signal: AbortSignal
): Promise<void> {
	const outcome = isFileIngest(message.body)
		? await runFileIngest(message.body.fileId, signal)
		: await runItem(queue, message, message.body.itemId, signal);
	if (outcome === "done") {
		await queue.ack(message);
	} else if (outcome === "interrupted") {
		await requeue(queue, message);
	}
}

async function runItem(
	queue: Queue<WorkerMessage>,
	message: ReceivedMessage<WorkerMessage>,
	itemId: string,
	signal: AbortSignal
): Promise<ItemOutcome> {
	try {
		return await processItem({
			itemId,
			messageId: message.id,
			extendVisibility: (seconds) => queue.changeVisibility(message, seconds),
			signal,
			releaseLeaseOnAbort: true
		});
	} catch (err) {
		contextLogger({ itemId }).error({ err }, "Item processing failed; message left for redelivery");
		return "redeliver";
	}
}

async function requeue(queue: Queue<WorkerMessage>, message: ReceivedMessage<WorkerMessage>): Promise<void> {
	await queue.send({ body: message.body, groupId: message.groupId, attributes: message.attributes });
	await queue.ack(message);
}
