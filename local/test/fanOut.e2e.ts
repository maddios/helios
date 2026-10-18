import { randomUUID } from "node:crypto";
import {
	DeleteMessageCommand,
	GetQueueUrlCommand,
	PurgeQueueCommand,
	ReceiveMessageCommand,
	SQSClient,
	type Message
} from "@aws-sdk/client-sqs";
import type { QueueName } from "@helios/contracts";
import {
	closeDb,
	dlqName,
	ensureIndexes,
	fanOut,
	fullQueueName,
	genericPreset,
	initDb,
	mediaAssets,
	pipelineItems,
	queueFor,
	queueTopology,
	requests,
	type ItemMessage,
	type MediaAsset
} from "@helios/core";
import { bootstrap } from "../bootstrap";
import { loadLocalConfig } from "../loadConfig";

const local = loadLocalConfig();
const sqs = new SQSClient({ region: local.awsRegion, endpoint: local.awsEndpoint });
const accountId = `e2e-${randomUUID()}`;
const POLL_DEADLINE_MS = 10000;

const asset: MediaAsset = {
	_id: randomUUID(),
	accountId,
	source: { bucket: local.mediaBucket, key: "e2e/source.mp4" },
	sourceMetadata: {
		type: "video",
		sizeBytes: 1000000,
		width: 1920,
		height: 1080,
		durationSec: 60,
		fps: 30,
		videoCodec: "h264",
		hasAudio: true
	},
	presetName: genericPreset.name,
	presetVersion: genericPreset.version,
	presetSnapshot: genericPreset,
	version: 1,
	outputs: {},
	createdAt: new Date(),
	updatedAt: new Date()
};

async function queueUrl(name: string): Promise<string> {
	const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: fullQueueName(local.e2eQueuePrefix, name) }));
	return QueueUrl!;
}

async function purgeAll(): Promise<void> {
	const names = queueTopology.flatMap((queue) =>
		queue.redrive.target === "dlq" ? [queue.name, dlqName(queue.name)] : [queue.name]
	);
	await Promise.all(
		names.map(async (name) => {
			try {
				await sqs.send(new PurgeQueueCommand({ QueueUrl: await queueUrl(name) }));
			} catch (err) {
				if (!(err instanceof Error) || err.name !== "PurgeQueueInProgress") {
					throw err;
				}
			}
		})
	);
}

async function receive(name: string, visibilityTimeout?: number): Promise<Message[]> {
	const { Messages = [] } = await sqs.send(
		new ReceiveMessageCommand({
			QueueUrl: await queueUrl(name),
			MaxNumberOfMessages: 10,
			WaitTimeSeconds: 2,
			VisibilityTimeout: visibilityTimeout,
			MessageAttributeNames: ["All"],
			MessageSystemAttributeNames: ["MessageGroupId", "ApproximateReceiveCount"]
		})
	);
	return Messages;
}

function bodyOf(message: Message): { itemId: string } {
	return JSON.parse(message.Body ?? "{}") as { itemId: string };
}

function attributeOf(message: Message, name: string): string | undefined {
	return message.MessageAttributes?.[name]?.StringValue;
}

async function receiveItem(name: string, itemId: string, visibilityTimeout?: number): Promise<Message[]> {
	return (await receive(name, visibilityTimeout)).filter((message) => bodyOf(message).itemId === itemId);
}

async function pollUntil(read: () => Promise<Message[]>, count: number): Promise<Message[]> {
	const deadline = Date.now() + POLL_DEADLINE_MS;
	const collected: Message[] = [];
	while (collected.length < count && Date.now() < deadline) {
		collected.push(...(await read()));
	}
	return collected;
}

describe("fanOut against real queues", () => {
	beforeAll(async () => {
		await bootstrap(local.e2eQueuePrefix, local.mediaBucket);
		await purgeAll();
		await initDb(local.mongoUri);
		await ensureIndexes();
		await mediaAssets().insertOne(asset);
	});

	afterAll(async () => {
		await Promise.all([
			mediaAssets().deleteMany({ accountId }),
			requests().deleteMany({ accountId }),
			pipelineItems().deleteMany({ accountId })
		]);
		await closeDb();
	});

	it("lands each item in its queue with attributes and, when fair queues are on, MessageGroupId", async () => {
		const { request } = await fanOut({ asset, mode: "encode", preset: genericPreset });
		expect(request.clientRequestId).toBe(request._id);
		expect(request.pendingItems).toHaveLength(6);
		expect(await pipelineItems().findOne({ _id: `${request._id}:scenes` })).toMatchObject({ status: "BLOCKED" });
		const expected: [QueueName, string[]][] = [
			["lambda-p1", ["mp4_360"]],
			["fargate-p2", ["audio", "mp4_720", "mp4_1080"]],
			["lambda-ai", ["transcribe"]]
		];

		for (const [queue, keys] of expected) {
			const messages = await pollUntil(
				async () => (await receive(queue)).filter((message) => attributeOf(message, "requestId") === request._id),
				keys.length
			);
			expect(messages.map(bodyOf)).toEqual(
				expect.arrayContaining(keys.map((key) => ({ itemId: `${request._id}:${key}` })))
			);
			expect(messages).toHaveLength(keys.length);
			for (const message of messages) {
				expect(attributeOf(message, "accountId")).toBe(accountId);
				expect(attributeOf(message, "assetId")).toBe(asset._id);
				expect(attributeOf(message, "itemId")).toBe(bodyOf(message).itemId);
				expect(message.Attributes?.MessageGroupId).toBe(local.sqsFairQueues ? accountId : undefined);
			}
		}
	});

	it("redrives lambda-p1 to fargate-p1 after two receives", async () => {
		const itemId = `e2e-${randomUUID()}:mp4_360`;
		await queueFor<ItemMessage>("lambda-p1").send({ body: { itemId } });

		const first = await receiveItem("lambda-p1", itemId, 0);
		expect(first).toHaveLength(1);
		const second = await receiveItem("lambda-p1", itemId, 0);
		expect(second).toHaveLength(1);
		expect(second[0].Attributes?.ApproximateReceiveCount).toBe("2");
		expect(await receiveItem("lambda-p1", itemId, 0)).toHaveLength(0);

		const moved = await pollUntil(() => receiveItem("fargate-p1", itemId, 0), 1);
		expect(moved).toHaveLength(1);
		expect(bodyOf(moved[0]).itemId).toBe(itemId);
		await sqs.send(
			new DeleteMessageCommand({ QueueUrl: await queueUrl("fargate-p1"), ReceiptHandle: moved[0].ReceiptHandle })
		);
	});
});
