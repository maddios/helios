import {
	DeleteMessageCommand,
	GetQueueUrlCommand,
	ReceiveMessageCommand,
	SendMessageBatchCommand,
	SendMessageCommand,
	SQSClient
} from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { queueFor, resetQueuesForTests, SqsQueue } from "../src/queue";

const sqsMock = mockClient(SQSClient);

function newQueue(name: string): SqsQueue<{ value?: number }> {
	return new SqsQueue(name, new SQSClient({ region: "us-east-2" }));
}

describe("SqsQueue", () => {
	beforeEach(() => {
		sqsMock.reset();
		sqsMock.on(GetQueueUrlCommand).resolves({ QueueUrl: "https://sqs/queue" });
	});

	it("resolves the queue URL once and caches it", async () => {
		const queue = newQueue("cached-queue");
		sqsMock.on(SendMessageCommand).resolves({});

		await queue.send({ body: { value: 1 } });
		await queue.send({ body: { value: 2 } });

		expect(sqsMock.commandCalls(GetQueueUrlCommand)).toHaveLength(1);
		expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(2);
	});

	it("splits sendBatch into chunks of 10", async () => {
		sqsMock.on(SendMessageBatchCommand).resolves({ Successful: [], Failed: [] });
		const messages = Array.from({ length: 23 }, (_, i) => ({ body: { value: i } }));

		await newQueue("batch-queue").sendBatch(messages);

		const calls = sqsMock.commandCalls(SendMessageBatchCommand);
		expect(calls.map((call) => call.args[0].input.Entries?.length)).toEqual([10, 10, 3]);
	});

	it("maps groupId, deduplicationId and attributes on send", async () => {
		sqsMock.on(SendMessageCommand).resolves({});

		await newQueue("mapped-queue").send({
			body: { value: 1 },
			groupId: "tenant",
			deduplicationId: "dedupe",
			attributes: { accountId: "acc-1" }
		});

		expect(sqsMock.commandCall(0, SendMessageCommand).args[0].input).toMatchObject({
			MessageBody: '{"value":1}',
			MessageGroupId: "tenant",
			MessageDeduplicationId: "dedupe",
			MessageAttributes: { accountId: { DataType: "String", StringValue: "acc-1" } }
		});
	});

	it("throws when any batch entry fails", async () => {
		sqsMock.on(SendMessageBatchCommand).resolves({
			Failed: [{ Id: "1", SenderFault: true, Code: "InvalidParameterValue", Message: "boom" }]
		});

		await expect(newQueue("failed-queue").sendBatch([{ body: {} }])).rejects.toThrow(
			"Failed to enqueue 1 SQS message(s): boom"
		);
	});

	it("parses body, attributes and receive count on poll", async () => {
		sqsMock.on(ReceiveMessageCommand).resolves({
			Messages: [
				{
					MessageId: "m1",
					ReceiptHandle: "rh-1",
					Body: '{"value":7}',
					MessageAttributes: { accountId: { DataType: "String", StringValue: "acc-1" } },
					Attributes: { ApproximateReceiveCount: "3" }
				}
			]
		});

		const messages = await newQueue("poll-queue").poll(1, 5);

		expect(messages).toEqual([
			{ id: "m1", receiptHandle: "rh-1", body: { value: 7 }, attributes: { accountId: "acc-1" }, receiveCount: 3 }
		]);
		expect(sqsMock.commandCall(0, ReceiveMessageCommand).args[0].input.MessageAttributeNames).toEqual(["All"]);
	});

	it("drops malformed bodies from poll without acking them", async () => {
		sqsMock.on(ReceiveMessageCommand).resolves({
			Messages: [
				{ MessageId: "bad", ReceiptHandle: "rh-bad", Body: "{not json", Attributes: { ApproximateReceiveCount: "1" } },
				{
					MessageId: "good",
					ReceiptHandle: "rh-good",
					Body: '{"value":3}',
					Attributes: { ApproximateReceiveCount: "1" }
				}
			]
		});

		const messages = await newQueue("malformed-queue").poll(2, 5);

		expect(messages.map((message) => message.id)).toEqual(["good"]);
		expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
	});

	it("prefixes the queue name in queueFor", async () => {
		resetQueuesForTests();
		sqsMock.on(SendMessageCommand).resolves({});

		await queueFor("lambda-p1").send({ body: {} });

		expect(sqsMock.commandCall(0, GetQueueUrlCommand).args[0].input.QueueName).toBe("helios-test-lambda-p1");
	});
});
