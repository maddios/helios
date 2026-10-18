import { queueFor, type ItemMessage, type Queue, type ReceivedMessage } from "@helios/core";
import { resetConfigForTests } from "../../src/config";
import { processItem } from "../../src/processItem";
import { processMessage, pollSequence, runWorker, LONG_POLL_SEC, WORKER_QUEUES } from "../../src/pollLoop";

jest.mock("@helios/core", () => ({
	...jest.requireActual("@helios/core"),
	queueFor: jest.fn(),
	contextLogger: jest.fn(() => ({ error: jest.fn() }))
}));
jest.mock("../../src/processItem", () => ({ processItem: jest.fn() }));

function message(): ReceivedMessage<ItemMessage> {
	return {
		id: "msg-1",
		receiptHandle: "handle-1",
		body: { itemId: "req-1:mp4_360" },
		attributes: { requestId: "req-1" },
		groupId: "acc-1",
		receiveCount: 1
	};
}

function fakeQueue() {
	return {
		send: jest.fn(),
		ack: jest.fn(),
		changeVisibility: jest.fn(),
		poll: jest.fn()
	} as unknown as Queue<ItemMessage> & {
		send: jest.Mock;
		ack: jest.Mock;
		poll: jest.Mock;
	};
}

describe("pollSequence", () => {
	it("short-polls the queues in tier order, then long-polls the first queue", () => {
		expect(pollSequence(WORKER_QUEUES)).toEqual([
			{ queue: "fargate-p1", waitSec: 0 },
			{ queue: "fargate-p2", waitSec: 0 },
			{ queue: "fargate-p3", waitSec: 0 },
			{ queue: "fargate-p4", waitSec: 0 },
			{ queue: "fargate-p1", waitSec: LONG_POLL_SEC }
		]);
	});

	it("throws when there are no queues", () => {
		expect(() => pollSequence([])).toThrow();
	});
});

describe("processMessage", () => {
	it("acks a message whose item outcome is done", async () => {
		const queue = fakeQueue();
		jest.mocked(processItem).mockResolvedValue("done");

		await processMessage(queue, message(), new AbortController().signal);

		expect(queue.ack).toHaveBeenCalledWith(expect.objectContaining({ id: "msg-1" }));
		expect(queue.send).not.toHaveBeenCalled();
	});

	it("leaves a busy message unacked for redelivery", async () => {
		const queue = fakeQueue();
		jest.mocked(processItem).mockResolvedValue("redeliver");

		await processMessage(queue, message(), new AbortController().signal);

		expect(queue.ack).not.toHaveBeenCalled();
		expect(queue.send).not.toHaveBeenCalled();
	});

	it("leaves a message unacked when processing throws", async () => {
		const queue = fakeQueue();
		jest.mocked(processItem).mockRejectedValue(new Error("boom"));

		await processMessage(queue, message(), new AbortController().signal);

		expect(queue.ack).not.toHaveBeenCalled();
		expect(queue.send).not.toHaveBeenCalled();
	});

	it("sends a fresh copy with the same body, attributes and group, then acks the old message, when interrupted", async () => {
		const queue = fakeQueue();
		jest.mocked(processItem).mockResolvedValue("interrupted");
		const calls: string[] = [];
		queue.send.mockImplementation(async () => calls.push("send"));
		queue.ack.mockImplementation(async () => calls.push("ack"));

		await processMessage(queue, message(), new AbortController().signal);

		expect(queue.send).toHaveBeenCalledWith({
			body: { itemId: "req-1:mp4_360" },
			groupId: "acc-1",
			attributes: { requestId: "req-1" }
		});
		expect(calls).toEqual(["send", "ack"]);
	});
});

describe("runWorker", () => {
	afterEach(() => {
		process.env.IDLE_EXIT = "false";
		resetConfigForTests();
		jest.restoreAllMocks();
	});

	it("exits once the queues have been idle for the idle timeout", async () => {
		process.env.IDLE_EXIT = "true";
		process.env.WORKER_IDLE_TIMEOUT_SEC = "1";
		resetConfigForTests();
		jest.mocked(queueFor).mockReturnValue({ poll: jest.fn().mockResolvedValue([]) } as never);
		jest.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(2000);

		await runWorker();

		expect(queueFor).toHaveBeenCalled();
	});

	it("backs off after a poll error and keeps running until aborted", async () => {
		const controller = new AbortController();
		const poll = jest
			.fn()
			.mockRejectedValueOnce(new Error("network down"))
			.mockImplementationOnce(async () => {
				controller.abort();
				return [];
			});
		jest.mocked(queueFor).mockReturnValue({ poll } as never);

		await runWorker({ signal: controller.signal });

		expect(poll).toHaveBeenCalledTimes(2);
	});
});
