import { failAnalyze, failDeadItem, markDeliveryFailed, queueNameFromArn } from "@helios/core";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { AnalyzeMessageSchema, CallbackMessageSchema, ItemMessageSchema } from "../sqs/messages";
import { parseBody } from "../sqs/records";
import { runRecords } from "../sqs/runRecords";

interface DeadLetterRoute {
	queue: RegExp;
	fail: (record: SQSRecord) => Promise<void>;
}

const ROUTES: DeadLetterRoute[] = [
	{
		queue: /-fargate-p\d+-dlq$/,
		fail: async (record) => failDeadItem(parseBody(record, ItemMessageSchema).itemId)
	},
	{
		queue: /-analyze-dlq$/,
		fail: async (record) => failAnalyze(parseBody(record, AnalyzeMessageSchema).requestId)
	},
	{
		queue: /-callbacks-dlq\.fifo$/,
		fail: async (record) => markDeliveryFailed(parseBody(record, CallbackMessageSchema))
	}
];

export function handler(event: SQSEvent): Promise<SQSBatchResponse> {
	return runRecords(event, routeRecord);
}

function routeRecord(record: SQSRecord): Promise<void> {
	const queueName = queueNameFromArn(record.eventSourceARN);
	const route = ROUTES.find(({ queue }) => queue.test(queueName));
	if (route === undefined) {
		throw new Error(`No dead-letter route for queue ${queueName}`);
	}
	return route.fail(record);
}
