import { QueueNameSchema } from "@helios/contracts";
import { dlqName, fullQueueName, queueTopology } from "../src/queue";

const redriveOf = (name: string) => queueTopology.find((queue) => queue.name === name)?.redrive;

describe("queueTopology", () => {
	it("defines every QueueName plus the callback FIFO queue", () => {
		const names = queueTopology.map((queue) => queue.name);
		expect(names).toEqual(expect.arrayContaining([...QueueNameSchema.options, "callbacks.fifo"]));
		expect(names).toHaveLength(QueueNameSchema.options.length + 1);
	});

	it("redrives lambda queues to their fargate queue", () => {
		expect(redriveOf("lambda-p1")).toEqual({ target: "fargate-p1", maxReceiveCount: 2 });
		expect(redriveOf("lambda-ai")).toEqual({ target: "fargate-p3", maxReceiveCount: 2 });
	});

	it("gives analyze, fargate queues and callbacks a dead-letter queue", () => {
		for (const name of ["analyze", "fargate-p1", "fargate-p2", "fargate-p3", "fargate-p4", "callbacks.fifo"]) {
			expect(redriveOf(name)).toEqual({ target: "dlq", maxReceiveCount: name === "callbacks.fifo" ? 6 : 3 });
		}
	});

	it("builds prefixed and dead-letter names", () => {
		expect(fullQueueName("helios-local", "lambda-p1")).toBe("helios-local-lambda-p1");
		expect(dlqName("fargate-p1")).toBe("fargate-p1-dlq");
		expect(dlqName("callbacks.fifo")).toBe("callbacks-dlq.fifo");
	});
});
