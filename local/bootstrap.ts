import {
	CreateBucketCommand,
	HeadBucketCommand,
	PutBucketCorsCommand,
	PutBucketLifecycleConfigurationCommand,
	S3Client,
	type BucketLifecycleConfiguration,
	type BucketLocationConstraint,
	type CORSConfiguration
} from "@aws-sdk/client-s3";
import {
	CreateEventBusCommand,
	DescribeEventBusCommand,
	EventBridgeClient,
	PutRuleCommand,
	PutTargetsCommand
} from "@aws-sdk/client-eventbridge";
import {
	CreateQueueCommand,
	GetQueueAttributesCommand,
	GetQueueUrlCommand,
	SetQueueAttributesCommand,
	SQSClient
} from "@aws-sdk/client-sqs";
import { dlqName, fullQueueName, isFifoName, queueTopology } from "@helios/core";
import { applyLocalEnv, loadLocalConfig, type LocalConfig } from "./loadConfig";

export interface BootstrapResult {
	created: string[];
	updated: string[];
}

const EVENT_BUS_NAME = "helios-local-customer-bus";
const EVENT_RULE_NAME = "helios-local-capture";
const CAPTURE_QUEUE = "eventbridge-capture";

export function localEventBusArn(local: LocalConfig): string {
	return `arn:aws:events:${local.awsRegion}:${local.localBusAccountId}:event-bus/${EVENT_BUS_NAME}`;
}

export function captureQueueName(local: LocalConfig): string {
	return fullQueueName(local.queuePrefix, CAPTURE_QUEUE);
}

export async function bootstrap(
	prefix: string,
	buckets: string[],
	visibilityTimeoutSec: number
): Promise<BootstrapResult> {
	const local = loadLocalConfig();
	const visibilityTimeout = String(visibilityTimeoutSec);
	const sqs = new SQSClient({ region: local.awsRegion, endpoint: local.awsEndpoint });
	const s3 = new S3Client({ region: local.awsRegion, endpoint: local.awsEndpoint, forcePathStyle: true });
	const result: BootstrapResult = { created: [], updated: [] };

	const arnByQueue = new Map<string, string>();
	for (const queue of queueTopology.filter((spec) => spec.redrive.target === "dlq")) {
		const dlqArn = await ensureQueue(
			sqs,
			fullQueueName(prefix, dlqName(queue.name)),
			undefined,
			result,
			visibilityTimeout
		);
		arnByQueue.set(
			queue.name,
			await ensureQueue(
				sqs,
				fullQueueName(prefix, queue.name),
				redrivePolicy(dlqArn, queue.redrive.maxReceiveCount),
				result,
				visibilityTimeout
			)
		);
	}
	for (const queue of queueTopology.filter((spec) => spec.redrive.target !== "dlq")) {
		const targetArn = arnByQueue.get(queue.redrive.target);
		if (targetArn === undefined) {
			throw new Error(`Redrive target ${queue.redrive.target} of ${queue.name} is not provisioned`);
		}
		await ensureQueue(
			sqs,
			fullQueueName(prefix, queue.name),
			redrivePolicy(targetArn, queue.redrive.maxReceiveCount),
			result,
			visibilityTimeout
		);
	}

	for (const bucket of buckets) {
		if (await ensureBucket(s3, bucket, local.awsRegion)) {
			result.created.push(bucket);
		}
	}
	await s3.send(
		new PutBucketCorsCommand({
			Bucket: local.mediaBucket,
			CORSConfiguration: mediaCorsConfiguration(local.uploadAllowedOrigins)
		})
	);
	result.updated.push(`${local.mediaBucket} CORS`);
	await s3.send(
		new PutBucketLifecycleConfigurationCommand({
			Bucket: local.mediaBucket,
			LifecycleConfiguration: mediaLifecycleConfiguration()
		})
	);
	result.updated.push(`${local.mediaBucket} lifecycle`);
	const eventbridge = new EventBridgeClient({ region: local.awsRegion, endpoint: local.awsEndpoint });
	await ensureEventCapture(eventbridge, sqs, local, result, visibilityTimeout);
	return result;
}

/**
 * Lifecycle of the media bucket: an upload that never completes is aborted after a week, so its parts stop costing money.
 * The infra template (`infra/media.yml`) carries the same rule.
 */
export function mediaLifecycleConfiguration(): BucketLifecycleConfiguration {
	return {
		Rules: [
			{
				ID: "abort-incomplete-multipart-uploads",
				Status: "Enabled",
				Filter: { Prefix: "" },
				AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 }
			}
		]
	};
}

/**
 * CORS rules of the media bucket, so browsers can PUT parts to presigned URLs from the allowed origins and read each
 * part's ETag. The infra template (`infra/media.yml`) carries the same rules.
 */
export function mediaCorsConfiguration(origins: string[]): CORSConfiguration {
	return {
		CORSRules: [
			{
				AllowedOrigins: origins,
				AllowedMethods: ["PUT", "GET", "HEAD"],
				AllowedHeaders: ["*"],
				ExposeHeaders: ["ETag"],
				MaxAgeSeconds: 3000
			}
		]
	};
}

function redrivePolicy(deadLetterTargetArn: string, maxReceiveCount: number): string {
	return JSON.stringify({ deadLetterTargetArn, maxReceiveCount });
}

async function ensureEventCapture(
	eventbridge: EventBridgeClient,
	sqs: SQSClient,
	local: LocalConfig,
	result: BootstrapResult,
	visibilityTimeout: string
): Promise<void> {
	const queueName = captureQueueName(local);
	const queueArn = await ensureQueue(sqs, queueName, undefined, result, visibilityTimeout);
	await ensureEventBus(eventbridge, result);
	const { RuleArn } = await eventbridge.send(
		new PutRuleCommand({
			Name: EVENT_RULE_NAME,
			EventBusName: EVENT_BUS_NAME,
			EventPattern: JSON.stringify({ source: [{ prefix: "helios." }] })
		})
	);
	if (RuleArn === undefined) {
		throw new Error(`No ARN returned for rule ${EVENT_RULE_NAME}`);
	}
	result.updated.push(EVENT_RULE_NAME);
	await eventbridge.send(
		new PutTargetsCommand({
			Rule: EVENT_RULE_NAME,
			EventBusName: EVENT_BUS_NAME,
			Targets: [{ Id: "capture", Arn: queueArn }]
		})
	);
	const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
	await sqs.send(new SetQueueAttributesCommand({ QueueUrl, Attributes: { Policy: capturePolicy(queueArn, RuleArn) } }));
}

async function ensureEventBus(eventbridge: EventBridgeClient, result: BootstrapResult): Promise<void> {
	try {
		await eventbridge.send(new DescribeEventBusCommand({ Name: EVENT_BUS_NAME }));
	} catch (err) {
		if (!(err instanceof Error) || err.name !== "ResourceNotFoundException") {
			throw err;
		}
		await eventbridge.send(new CreateEventBusCommand({ Name: EVENT_BUS_NAME }));
		result.created.push(EVENT_BUS_NAME);
	}
}

function capturePolicy(queueArn: string, ruleArn: string): string {
	return JSON.stringify({
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Principal: { Service: "events.amazonaws.com" },
				Action: "sqs:SendMessage",
				Resource: queueArn,
				Condition: { ArnEquals: { "aws:SourceArn": ruleArn } }
			}
		]
	});
}

async function ensureQueue(
	sqs: SQSClient,
	name: string,
	redrive: string | undefined,
	result: BootstrapResult,
	visibilityTimeout: string
): Promise<string> {
	const { QueueUrl } = await sqs.send(
		new CreateQueueCommand({
			QueueName: name,
			Attributes: isFifoName(name) ? { FifoQueue: "true", ContentBasedDeduplication: "true" } : undefined
		})
	);
	result.created.push(name);
	await sqs.send(
		new SetQueueAttributesCommand({
			QueueUrl,
			Attributes: {
				VisibilityTimeout: visibilityTimeout,
				...(redrive !== undefined && { RedrivePolicy: redrive })
			}
		})
	);
	result.updated.push(name);
	const { Attributes } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ["QueueArn"] }));
	const arn = Attributes?.QueueArn;
	if (arn === undefined) {
		throw new Error(`No ARN returned for queue ${name}`);
	}
	return arn;
}

async function ensureBucket(s3: S3Client, bucket: string, region: string): Promise<boolean> {
	try {
		await s3.send(new HeadBucketCommand({ Bucket: bucket }));
		return false;
	} catch (err) {
		if (!(err instanceof Error) || err.name !== "NotFound") {
			throw err;
		}
		await s3.send(
			new CreateBucketCommand({
				Bucket: bucket,
				CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint }
			})
		);
		return true;
	}
}

if (require.main === module) {
	const local = loadLocalConfig();
	applyLocalEnv(local, { e2e: false });
	bootstrap(local.queuePrefix, [local.mediaBucket, local.sourceBucket], local.worker.visibilityExtensionSec)
		.then((result) => {
			for (const name of result.created) {
				console.log(`created ${name}`);
			}
			for (const name of result.updated) {
				console.log(`updated ${name}`);
			}
		})
		.catch((err: unknown) => {
			console.error(err);
			process.exitCode = 1;
		});
}
