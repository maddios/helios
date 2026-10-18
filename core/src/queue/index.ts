import { SQSClient } from "@aws-sdk/client-sqs";
import { config } from "../config";
import { SqsQueue } from "./sqsQueue";
import type { Queue } from "./types";
import { fullQueueName, type AnyQueueName } from "./topology";

export * from "./types";
export * from "./topology";
export { SqsQueue };

let client: SQSClient | undefined;
const queues = new Map<AnyQueueName, Queue<unknown>>();

function sqsClient(): SQSClient {
	client ??= new SQSClient({ region: config().AWS_REGION, endpoint: config().SQS_ENDPOINT });
	return client;
}

export function queueFor<T>(name: AnyQueueName): Queue<T> {
	let queue = queues.get(name);
	if (queue === undefined) {
		queue = new SqsQueue<unknown>(fullQueueName(config().QUEUE_PREFIX, name), sqsClient());
		queues.set(name, queue);
	}
	return queue as Queue<T>;
}

export function resetQueuesForTests(): void {
	queues.clear();
	client = undefined;
}
