import { z } from "zod";

export const ItemQueueNameSchema = z
	.enum(["lambda-p1", "lambda-ai", "fargate-p1", "fargate-p2", "fargate-p3", "fargate-p4"])
	.describe("Queue a pipeline item is dispatched to");
export type ItemQueueName = z.infer<typeof ItemQueueNameSchema>;

export const QueueNameSchema = z
	.enum([...ItemQueueNameSchema.options, "analyze"])
	.describe("Queue a message is sent to, including the analyze queue");
export type QueueName = z.infer<typeof QueueNameSchema>;
