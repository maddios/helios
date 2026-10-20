import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { DestinationSchema, FileImageSchema, FileStatusSchema, UploadPolicySchema } from "@helios/contracts";
import { db } from "../db";

export const FileRecordSchema = z.object({
	_id: z.string(),
	accountId: z.string(),
	key: z.string(),
	filename: z.string(),
	status: FileStatusSchema,
	source: z.enum(["upload", "url"]),
	policy: UploadPolicySchema,
	declaredContentType: z.string().optional(),
	declaredSizeBytes: z.int().nonnegative().optional(),
	contentType: z.string().optional(),
	sizeBytes: z.int().nonnegative().optional(),
	image: FileImageSchema.optional(),
	uploadId: z.string().optional(),
	partCount: z.int().positive().optional(),
	sourceUrl: z.string().optional(),
	destination: DestinationSchema.optional(),
	externalId: z.string().optional(),
	error: z.string().optional(),
	expiresAt: z.date().optional(),
	createdAt: z.date(),
	storedAt: z.date().optional(),
	deletedAt: z.date().optional()
});
export type FileRecord = z.infer<typeof FileRecordSchema>;

export const files = () => db().collection<FileRecord>("files");

export const fileIndexes: IndexDescription[] = [
	{ key: { accountId: 1, createdAt: -1 } },
	{ key: { accountId: 1, externalId: 1 } },
	{ key: { status: 1, expiresAt: 1 }, partialFilterExpression: { status: "PENDING" } }
];
