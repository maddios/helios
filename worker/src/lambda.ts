import type { Context, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { config as coreConfig, contextLogger, initDb, queueFromArn, type ItemMessage } from "@helios/core";
import { z } from "zod";
import { validateWorkerConfig } from "./config";
import { isFileIngest, runFileIngest, type WorkerMessage } from "./fileIngest";
import { processItem, type ItemOutcome } from "./processItem";

const ABORT_BEFORE_TIMEOUT_MS = 10_000;
const TIMEOUT_REASON = "Lambda timeout approaching";

const BodySchema = z.union([z.object({ itemId: z.string().min(1) }), z.object({ fileId: z.string().min(1) })]);

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
	context.callbackWaitsForEmptyEventLoop = false;
	validateWorkerConfig();
	if (event.Records.length !== 1) {
		throw new Error(`Expected one SQS record per invocation, got ${event.Records.length}`);
	}
	const [record] = event.Records;
	const outcome = await runRecord(record, context);
	return { batchItemFailures: outcome === "done" ? [] : [{ itemIdentifier: record.messageId }] };
}

async function runRecord(record: SQSRecord, context: Context): Promise<ItemOutcome> {
	const controller = new AbortController();
	const abortTimer = setTimeout(
		() => controller.abort(new Error(TIMEOUT_REASON)),
		Math.max(0, context.getRemainingTimeInMillis() - ABORT_BEFORE_TIMEOUT_MS)
	);
	try {
		const body: WorkerMessage = BodySchema.parse(JSON.parse(record.body));
		await initDb(coreConfig().MONGO_URI);
		if (isFileIngest(body)) {
			return runFileIngest(body.fileId, AbortSignal.timeout(coreConfig().LAMBDA_MAX_DURATION_SEC * 1000));
		}
		return await processItem({
			itemId: body.itemId,
			messageId: record.messageId,
			extendVisibility: (seconds) =>
				queueFromArn<ItemMessage>(record.eventSourceARN).changeVisibility(
					{ receiptHandle: record.receiptHandle },
					seconds
				),
			signal: controller.signal,
			releaseLeaseOnAbort: false
		});
	} catch (err) {
		contextLogger({}).error({ err }, "Item processing failed; message returned for redelivery");
		return "redeliver";
	} finally {
		clearTimeout(abortTimer);
	}
}
