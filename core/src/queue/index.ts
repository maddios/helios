import { SQSClient } from "@aws-sdk/client-sqs";
import { config } from "../config";
import { SqsQueue } from "./sqsQueue";
import type { Queue } from "./types";
import { fullQueueName, queueNameFromArn, type AnyQueueName } from "./topology";

export * from "./types";
export * from "./topology";
export { SqsQueue };

let client: SQSClient | undefined;
const queues = new Map<string, Queue<unknown>>();

function sqsClient(): SQSClient {
	client ??= new SQSClient({ region: config().AWS_REGION, endpoint: config().SQS_ENDPOINT });
	return client;
}

function queueNamed<T>(fullName: string): Queue<T> {
	let queue = queues.get(fullName);
	if (queue === undefined) {
		queue = new SqsQueue<unknown>(fullName, sqsClient());
		queues.set(fullName, queue);
	}
	return queue as Queue<T>;
}

export function queueFor<T>(name: AnyQueueName): Queue<T> {
	return queueNamed<T>(fullQueueName(config().QUEUE_PREFIX, name));
}

export function queueFromArn<T>(arn: string): Queue<T> {
	return queueNamed<T>(queueNameFromArn(arn));
}

export function resetQueuesForTests(): void {
	queues.clear();
	client = undefined;
}
