import type { QueueName } from "@helios/contracts";

export type RedriveTarget = QueueName | "dlq";

export interface Redrive {
	target: RedriveTarget;
	maxReceiveCount: number;
}

export type AnyQueueName = QueueName | "callbacks.fifo";

export interface QueueSpec {
	name: AnyQueueName;
	redrive: Redrive;
}

const queueRedrives: Record<QueueName, Redrive> = {
	"lambda-p1": { target: "fargate-p1", maxReceiveCount: 2 },
	"lambda-ai": { target: "fargate-p3", maxReceiveCount: 2 },
	analyze: { target: "dlq", maxReceiveCount: 3 },
	"fargate-p1": { target: "dlq", maxReceiveCount: 3 },
	"fargate-p2": { target: "dlq", maxReceiveCount: 3 },
	"fargate-p3": { target: "dlq", maxReceiveCount: 3 },
	"fargate-p4": { target: "dlq", maxReceiveCount: 3 }
};

export const queueTopology: QueueSpec[] = [
	...Object.entries(queueRedrives).map(([name, redrive]) => ({ name: name as QueueName, redrive })),
	{ name: "callbacks.fifo", redrive: { target: "dlq", maxReceiveCount: 6 } }
];

export const FARGATE_QUEUE_NAMES = ["fargate-p1", "fargate-p2", "fargate-p3", "fargate-p4"] as const;
export type FargateQueueName = (typeof FARGATE_QUEUE_NAMES)[number];

export function isFargateQueue(name: string): name is FargateQueueName {
	return (FARGATE_QUEUE_NAMES as readonly string[]).includes(name);
}

export function queueNameFromArn(arn: string): string {
	return arn.split(":")[5];
}

export function fullQueueName(prefix: string, name: string): string {
	return `${prefix}-${name}`;
}

export function isFifoName(name: string): boolean {
	return name.endsWith(".fifo");
}

export function dlqName(name: string): string {
	return isFifoName(name) ? `${name.slice(0, -".fifo".length)}-dlq.fifo` : `${name}-dlq`;
}
