import type { SQSRecord } from "aws-lambda";

export const QUEUE_PREFIX = "helios-test";

export function queueArn(name: string): string {
	return `arn:aws:sqs:us-east-2:000000000000:${QUEUE_PREFIX}-${name}`;
}

export function sqsRecord(
	messageId: string,
	body: unknown,
	{ queue = "callbacks.fifo", receiveCount = 1 }: { queue?: string; receiveCount?: number } = {}
): SQSRecord {
	return {
		messageId,
		receiptHandle: `rh-${messageId}`,
		body: typeof body === "string" ? body : JSON.stringify(body),
		attributes: {
			ApproximateReceiveCount: String(receiveCount),
			MessageGroupId: "req-1",
			SentTimestamp: "0",
			SenderId: "sender",
			ApproximateFirstReceiveTimestamp: "0"
		},
		messageAttributes: {},
		md5OfBody: "md5",
		eventSource: "aws:sqs",
		awsRegion: "us-east-2",
		eventSourceARN: queueArn(queue)
	};
}
