import { z } from "zod";

export const QueueNameSchema = z
	.enum(["lambda-p1", "lambda-ai", "fargate-p1", "fargate-p2", "fargate-p3", "fargate-p4"])
	.describe("Queue an item is dispatched to");
export type QueueName = z.infer<typeof QueueNameSchema>;
