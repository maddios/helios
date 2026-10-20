import { files, type FileRecord } from "../models";

export interface StoredContent {
	contentType: string;
	sizeBytes: number;
	image?: FileRecord["image"];
}

/** Claims a pending, undeleted file as stored. Undefined when another path has already claimed or deleted it. */
export async function markStored(file: FileRecord, content: StoredContent): Promise<FileRecord | undefined> {
	const stored = await files().findOneAndUpdate(
		{ _id: file._id, status: "PENDING", deletedAt: { $exists: false } },
		{ $set: { status: "STORED", ...content, storedAt: new Date() }, $unset: { uploadId: "", expiresAt: "" } },
		{ returnDocument: "after" }
	);
	return stored ?? undefined;
}

/** Claims a pending, undeleted file as failed. False when another path has already claimed or deleted it. */
export async function markFailed(file: FileRecord, error: string): Promise<boolean> {
	const result = await files().updateOne(
		{ _id: file._id, status: "PENDING", deletedAt: { $exists: false } },
		{ $set: { status: "FAILED", error }, $unset: { uploadId: "", expiresAt: "" } }
	);
	return result.matchedCount === 1;
}
