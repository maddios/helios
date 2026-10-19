import { analyzeRequest } from "@helios/core";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { AnalyzeMessageSchema } from "../sqs/messages";
import { parseBody } from "../sqs/records";
import { runRecords } from "../sqs/runRecords";

export function handler(event: SQSEvent): Promise<SQSBatchResponse> {
	return runRecords(event, async (record) => {
		await analyzeRequest(parseBody(record, AnalyzeMessageSchema).requestId);
	});
}
