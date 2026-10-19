import {
	DeleteMessageCommand,
	GetQueueUrlCommand,
	ReceiveMessageCommand,
	SQSClient,
	type Message
} from "@aws-sdk/client-sqs";
import type { Context, SQSEvent, SQSBatchResponse, SQSRecord } from "aws-lambda";
import {
	closeDb,
	config as coreConfig,
	dlqName,
	fullQueueName,
	initDb,
	logger,
	queueNameFromArn,
	queueTopology,
	resumeStuckRequests
} from "@helios/core";
import { analyzeHandler, callbackHandler, dlqHandler } from "../functions/src";
import { validateWorkerConfig } from "../worker/src/config";
import { handler as encoderHandler } from "../worker/src/lambda";
import { applyLocalEnv, loadLocalConfig } from "./loadConfig";

export type LambdaSourceKey = "analyze" | "lambda-p1" | "lambda-ai" | "callbacks.fifo" | "dlq";

interface LambdaSource {
	key: LambdaSourceKey;
	queueName: string;
	handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse>;
}

interface RunOptions {
	sqs: SQSClient;
	signal: AbortSignal;
	queuePrefix: string;
	pollWaitSec: number;
	region: string;
	accountId: string;
	timeoutSec: number;
}

const ERROR_BACKOFF_MS = 1000;

const SOURCES: LambdaSource[] = [
	{ key: "analyze", queueName: "analyze", handler: analyzeHandler },
	{ key: "lambda-p1", queueName: "lambda-p1", handler: encoderHandler },
	{ key: "lambda-ai", queueName: "lambda-ai", handler: encoderHandler },
	{ key: "callbacks.fifo", queueName: "callbacks.fifo", handler: callbackHandler },
	...queueTopology
		.filter((spec) => spec.redrive.target === "dlq")
		.map((spec): LambdaSource => ({ key: "dlq", queueName: dlqName(spec.name), handler: dlqHandler }))
];

export async function runLambdaSources({
	signal,
	timeoutsSec = {}
}: {
	signal: AbortSignal;
	timeoutsSec?: Partial<Record<LambdaSourceKey, number>>;
}): Promise<void> {
	const local = loadLocalConfig();
	const env = coreConfig();
	const sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.SQS_ENDPOINT });
	const base = {
		sqs,
		signal,
		queuePrefix: env.QUEUE_PREFIX,
		pollWaitSec: local.lambdas.pollWaitSec,
		region: env.AWS_REGION,
		accountId: env.HELIOS_AWS_ACCOUNT_ID
	};
	await Promise.all([
		...SOURCES.map((source) =>
			runSource(source, { ...base, timeoutSec: timeoutsSec[source.key] ?? local.lambdas.timeoutsSec[source.key] })
		),
		runLoop(signal, async () => {
			await resumeStuckRequests(new Date());
			await sleep(local.lambdas.resumeIntervalSec * 1000, signal);
		})
	]);
	sqs.destroy();
}

function runSource(source: LambdaSource, options: RunOptions): Promise<void> {
	const { sqs, signal, pollWaitSec, region, accountId, timeoutSec } = options;
	const queueName = fullQueueName(options.queuePrefix, source.queueName);
	const eventSourceARN = `arn:aws:sqs:${region}:${accountId}:${queueName}`;
	let QueueUrl: string | undefined;
	return runLoop(signal, async () => {
		QueueUrl ??= requireField(
			(await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }), { abortSignal: signal })).QueueUrl,
			"QueueUrl"
		);
		const { Messages = [] } = await sqs.send(
			new ReceiveMessageCommand({
				QueueUrl,
				MaxNumberOfMessages: 1,
				WaitTimeSeconds: pollWaitSec,
				MessageSystemAttributeNames: ["All"],
				MessageAttributeNames: ["All"]
			}),
			{ abortSignal: signal }
		);
		for (const message of Messages) {
			await deliver(message, { sqs, QueueUrl, source, eventSourceARN, region, timeoutSec });
		}
	});
}

interface DeliveryOptions {
	sqs: SQSClient;
	QueueUrl: string;
	source: LambdaSource;
	eventSourceARN: string;
	region: string;
	timeoutSec: number;
}

async function deliver(message: Message, options: DeliveryOptions): Promise<void> {
	const { sqs, QueueUrl, source, eventSourceARN, region, timeoutSec } = options;
	const record = toSqsRecord(message, eventSourceARN, region);
	const started = Date.now();
	const context = {
		getRemainingTimeInMillis: () => timeoutSec * 1000 - (Date.now() - started),
		callbackWaitsForEmptyEventLoop: true
	} as Context;
	try {
		const result = await source.handler({ Records: [record] }, context);
		if (result.batchItemFailures.length > 0) {
			return;
		}
	} catch (err) {
		logger().error({ err, queue: queueNameFromArn(eventSourceARN) }, "Handler threw; message left for redelivery");
		return;
	}
	await sqs.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: record.receiptHandle }));
}

function toSqsRecord(message: Message, eventSourceARN: string, region: string): SQSRecord {
	return {
		messageId: requireField(message.MessageId, "MessageId"),
		receiptHandle: requireField(message.ReceiptHandle, "ReceiptHandle"),
		body: requireField(message.Body, "Body"),
		attributes: requireField(message.Attributes, "Attributes") as SQSRecord["attributes"],
		messageAttributes: Object.fromEntries(
			Object.entries(message.MessageAttributes ?? {}).map(([name, value]) => [
				name,
				{ stringValue: value.StringValue, dataType: requireField(value.DataType, "DataType") }
			])
		),
		md5OfBody: requireField(message.MD5OfBody, "MD5OfBody"),
		eventSource: "aws:sqs",
		eventSourceARN,
		awsRegion: region
	};
}

function requireField<T>(value: T | undefined, name: string): T {
	if (value === undefined) {
		throw new Error(`SQS message is missing ${name}`);
	}
	return value;
}

async function runLoop(signal: AbortSignal, step: () => Promise<void>): Promise<void> {
	while (!signal.aborted) {
		try {
			await step();
		} catch (err) {
			if (!signal.aborted) {
				logger().error({ err }, "Lambda runner step failed; retrying");
				await sleep(ERROR_BACKOFF_MS, signal);
			}
		}
	}
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const finish = (): void => {
			clearTimeout(timer);
			signal.removeEventListener("abort", finish);
			resolve();
		};
		const timer = setTimeout(finish, ms);
		signal.addEventListener("abort", finish);
	});
}

export async function main(): Promise<void> {
	const local = loadLocalConfig();
	applyLocalEnv(local, { e2e: false });
	process.env.WORKER_TIER = "lambda";
	process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = String(local.lambdas.memoryMb);
	validateWorkerConfig();
	await initDb(coreConfig().MONGO_URI);
	const controller = new AbortController();
	const stop = (): void => controller.abort(new Error("Lambda runner stopping"));
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	try {
		await runLambdaSources({ signal: controller.signal });
	} finally {
		await closeDb();
	}
}

if (require.main === module) {
	main().catch((err: unknown) => {
		logger().error({ err }, "Lambda runner failed");
		process.exitCode = 1;
	});
}
