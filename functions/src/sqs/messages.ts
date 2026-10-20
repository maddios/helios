import { z } from "zod";

export const AnalyzeMessageSchema = z.object({ requestId: z.string() });

export const ItemMessageSchema = z.object({ itemId: z.string() });

export const FileIngestMessageSchema = z.object({ fileId: z.string() });

const sequence = z.int().positive();

export const CallbackMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("item"), requestId: z.string(), itemId: z.string(), sequence }),
	z.object({ type: z.literal("request"), requestId: z.string(), sequence }),
	z.object({
		type: z.literal("file"),
		accountId: z.string(),
		fileId: z.string(),
		event: z.enum(["file.stored", "file.failed"]),
		sequence: z.literal(1)
	})
]);
