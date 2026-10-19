import { CallbackDeliveryError, deliverCallback, queueFor, type CallbackMessage } from "@helios/core";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { CallbackMessageSchema } from "../sqs/messages";
import { parseBody, toReceivedMessage } from "../sqs/records";
import { runRecords } from "../sqs/runRecords";

export function handler(event: SQSEvent): Promise<SQSBatchResponse> {
	return runRecords(event, deliverRecord);
}

async function deliverRecord(record: SQSRecord): Promise<void> {
	const message = parseBody(record, CallbackMessageSchema);
	const received = toReceivedMessage<CallbackMessage>(record, message);
	try {
		await deliverCallback(message, received.receiveCount);
	} catch (err) {
		if (err instanceof CallbackDeliveryError) {
			await queueFor<CallbackMessage>("callbacks.fifo").changeVisibility(received, err.backoffSec);
		}
		throw err;
	}
}
