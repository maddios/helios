import { logger } from "@helios/core";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { connectOnce } from "../runtime/connect";

export async function runRecords(
	event: SQSEvent,
	work: (record: SQSRecord) => Promise<void>
): Promise<SQSBatchResponse> {
	if (event.Records.length !== 1) {
		throw new Error(`Expected one SQS record per invocation, got ${event.Records.length}`);
	}
	const [record] = event.Records;
	try {
		await connectOnce();
		await work(record);
		return { batchItemFailures: [] };
	} catch (err) {
		logger().error({ err, messageId: record.messageId }, "SQS record failed and is left for redelivery");
		return { batchItemFailures: [{ itemIdentifier: record.messageId }] };
	}
}
