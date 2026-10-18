import { CreateBucketCommand, HeadBucketCommand, S3Client, type BucketLocationConstraint } from "@aws-sdk/client-s3";
import {
	CreateQueueCommand,
	GetQueueAttributesCommand,
	SetQueueAttributesCommand,
	SQSClient
} from "@aws-sdk/client-sqs";
import { dlqName, fullQueueName, isFifoName, queueTopology } from "@helios/core";
import { applyLocalEnv, loadLocalConfig } from "./loadConfig";

const VISIBILITY_TIMEOUT_SEC = "30";

export interface BootstrapResult {
	created: string[];
	updated: string[];
}

export async function bootstrap(prefix: string, bucket: string): Promise<BootstrapResult> {
	const local = loadLocalConfig();
	const sqs = new SQSClient({ region: local.awsRegion, endpoint: local.awsEndpoint });
	const s3 = new S3Client({ region: local.awsRegion, endpoint: local.awsEndpoint, forcePathStyle: true });
	const result: BootstrapResult = { created: [], updated: [] };

	const arnByQueue = new Map<string, string>();
	for (const queue of queueTopology.filter((spec) => spec.redrive.target === "dlq")) {
		const dlqArn = await ensureQueue(sqs, fullQueueName(prefix, dlqName(queue.name)), undefined, result);
		arnByQueue.set(
			queue.name,
			await ensureQueue(
				sqs,
				fullQueueName(prefix, queue.name),
				redrivePolicy(dlqArn, queue.redrive.maxReceiveCount),
				result
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
			result
		);
	}

	if (await ensureBucket(s3, bucket, local.awsRegion)) {
		result.created.push(bucket);
	}
	return result;
}

function redrivePolicy(deadLetterTargetArn: string, maxReceiveCount: number): string {
	return JSON.stringify({ deadLetterTargetArn, maxReceiveCount });
}

async function ensureQueue(
	sqs: SQSClient,
	name: string,
	redrive: string | undefined,
	result: BootstrapResult
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
				VisibilityTimeout: VISIBILITY_TIMEOUT_SEC,
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
	bootstrap(local.queuePrefix, local.mediaBucket)
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
