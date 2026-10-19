import {
	ChangeMessageVisibilityCommand,
	DeleteMessageCommand,
	GetQueueAttributesCommand,
	GetQueueUrlCommand,
	ReceiveMessageCommand,
	SendMessageBatchCommand,
	SendMessageCommand,
	type Message,
	type MessageAttributeValue,
	type SendMessageBatchRequestEntry,
	type SQSClient
} from "@aws-sdk/client-sqs";
import { randomUUID } from "crypto";
import { logger } from "../logger";
import type { OutgoingMessage, Queue, ReceivedMessage } from "./types";

const BATCH_SIZE = 10;

function toMessageAttributeValues(attributes: Record<string, string>): Record<string, MessageAttributeValue> {
	return Object.fromEntries(
		Object.entries(attributes).map(([name, value]) => [name, { DataType: "String", StringValue: value }])
	);
}

function parseBody<T>(message: Message): T | undefined {
	try {
		return JSON.parse(message.Body ?? "") as T;
	} catch {
		logger().error({ messageId: message.MessageId }, "Malformed SQS message body; left for SQS redrive");
		return undefined;
	}
}

function toSendFields<T>(message: OutgoingMessage<T>) {
	return {
		MessageBody: JSON.stringify(message.body),
		MessageGroupId: message.groupId,
		MessageDeduplicationId: message.deduplicationId,
		MessageAttributes: message.attributes && toMessageAttributeValues(message.attributes)
	};
}

function toReceived<T>(message: Message, body: T): ReceivedMessage<T> {
	return {
		id: message.MessageId!,
		receiptHandle: message.ReceiptHandle!,
		body,
		attributes: Object.fromEntries(
			Object.entries(message.MessageAttributes ?? {}).flatMap(([name, value]) =>
				value.StringValue === undefined ? [] : [[name, value.StringValue]]
			)
		),
		groupId: message.Attributes?.MessageGroupId,
		receiveCount: Number(message.Attributes!.ApproximateReceiveCount)
	};
}

export class SqsQueue<T> implements Queue<T> {
	private queueUrlCache?: string;

	constructor(
		private readonly fullQueueName: string,
		private readonly client: SQSClient
	) {}

	async send(message: OutgoingMessage<T>): Promise<void> {
		await this.client.send(new SendMessageCommand({ QueueUrl: await this.queueUrl(), ...toSendFields(message) }));
	}

	async sendBatch(messages: OutgoingMessage<T>[]): Promise<void> {
		if (messages.length === 0) {
			return;
		}
		const QueueUrl = await this.queueUrl();
		const entries: SendMessageBatchRequestEntry[] = messages.map((message) => ({
			Id: randomUUID(),
			...toSendFields(message)
		}));
		const chunks: SendMessageBatchRequestEntry[][] = [];
		for (let i = 0; i < entries.length; i += BATCH_SIZE) {
			chunks.push(entries.slice(i, i + BATCH_SIZE));
		}
		const results = await Promise.all(
			chunks.map((Entries) => this.client.send(new SendMessageBatchCommand({ QueueUrl, Entries })))
		);
		const failed = results.flatMap((result) => result.Failed ?? []);
		if (failed.length > 0) {
			throw new Error(`Failed to enqueue ${failed.length} SQS message(s): ${failed.map((f) => f.Message).join("; ")}`);
		}
	}

	async poll(
		maxMessages: number,
		waitTimeSeconds: number,
		visibilityTimeoutSeconds?: number,
		signal?: AbortSignal
	): Promise<ReceivedMessage<T>[]> {
		const { Messages = [] } = await this.client.send(
			new ReceiveMessageCommand({
				QueueUrl: await this.queueUrl(),
				MaxNumberOfMessages: maxMessages,
				WaitTimeSeconds: waitTimeSeconds,
				VisibilityTimeout: visibilityTimeoutSeconds,
				MessageAttributeNames: ["All"],
				MessageSystemAttributeNames: ["ApproximateReceiveCount", "MessageGroupId"]
			}),
			{ abortSignal: signal }
		);
		return Messages.flatMap((message) => {
			const body = parseBody<T>(message);
			return body === undefined ? [] : [toReceived(message, body)];
		});
	}

	async ack(message: ReceivedMessage<T>): Promise<void> {
		await this.client.send(
			new DeleteMessageCommand({ QueueUrl: await this.queueUrl(), ReceiptHandle: message.receiptHandle })
		);
	}

	async changeVisibility(message: Pick<ReceivedMessage<T>, "receiptHandle">, seconds: number): Promise<void> {
		await this.client.send(
			new ChangeMessageVisibilityCommand({
				QueueUrl: await this.queueUrl(),
				ReceiptHandle: message.receiptHandle,
				VisibilityTimeout: seconds
			})
		);
	}

	async approximateBacklog(): Promise<number> {
		const { Attributes } = await this.client.send(
			new GetQueueAttributesCommand({
				QueueUrl: await this.queueUrl(),
				AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"]
			})
		);
		const visible = Attributes?.ApproximateNumberOfMessages;
		const inFlight = Attributes?.ApproximateNumberOfMessagesNotVisible;
		if (visible === undefined || inFlight === undefined) {
			throw new Error(`No message counts returned for queue ${this.fullQueueName}`);
		}
		return Number(visible) + Number(inFlight);
	}

	private async queueUrl(): Promise<string> {
		if (this.queueUrlCache !== undefined) {
			return this.queueUrlCache;
		}
		const { QueueUrl } = await this.client.send(new GetQueueUrlCommand({ QueueName: this.fullQueueName }));
		if (QueueUrl === undefined) {
			throw new Error(`Queue not found: ${this.fullQueueName}`);
		}
		this.queueUrlCache = QueueUrl;
		return QueueUrl;
	}
}
