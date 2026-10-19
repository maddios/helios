import { type ReceivedMessage } from "@helios/core";
import type { SQSRecord } from "aws-lambda";
import type { z } from "zod";

export function parseBody<T>(record: SQSRecord, schema: z.ZodType<T>): T {
	return schema.parse(JSON.parse(record.body));
}

export function toReceivedMessage<T>(record: SQSRecord, body: T): ReceivedMessage<T> {
	return {
		id: record.messageId,
		receiptHandle: record.receiptHandle,
		body,
		attributes: Object.fromEntries(
			Object.entries(record.messageAttributes).flatMap(([name, value]) =>
				value.stringValue === undefined ? [] : [[name, value.stringValue]]
			)
		),
		groupId: record.attributes.MessageGroupId,
		receiveCount: Number(record.attributes.ApproximateReceiveCount)
	};
}
