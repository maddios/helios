import { ConflictError, NotFoundError } from "@helios/contracts";
import { files, mediaAssets, requests, type FileRecord } from "../models";
import { invalidateFileKey } from "../cdn";
import { releaseFileObjects } from "./release";

const OPEN_STATUSES = ["ANALYZING", "IN_PROGRESS"] as const;

/**
 * Deletes a file. The record is claimed first, so no complete, ingest or expiry can store the file meanwhile.
 * A file that a non-terminal request reads is released again and answered with 409 file_in_use.
 */
export async function deleteFile(accountId: string, fileId: string): Promise<void> {
	const claimed = await claimDelete(accountId, fileId);
	if (await isReadByOpenRequest(claimed)) {
		await files().updateOne({ _id: fileId, deletedAt: claimed.deletedAt }, { $unset: { deletedAt: "" } });
		throw new ConflictError(`File ${fileId} is used by a request that has not finished`, { fileId }, "file_in_use");
	}
	await releaseFileObjects(claimed);
	await invalidateFileKey(claimed.key, `file-delete:${fileId}`);
}

async function claimDelete(accountId: string, fileId: string): Promise<FileRecord & { deletedAt: Date }> {
	const deletedAt = new Date();
	const before = await files().findOneAndUpdate(
		{ _id: fileId, accountId, deletedAt: { $exists: false } },
		{ $set: { deletedAt } },
		{ returnDocument: "before" }
	);
	if (before === null) {
		throw new NotFoundError(`File ${fileId} not found`);
	}
	return { ...before, deletedAt };
}

async function isReadByOpenRequest(file: FileRecord): Promise<boolean> {
	const assetIds = (
		await mediaAssets()
			.find({ accountId: file.accountId, "source.type": "file", "source.fileId": file._id }, { projection: { _id: 1 } })
			.toArray()
	).map((asset) => asset._id);
	if (assetIds.length === 0) {
		return false;
	}
	return (
		(await requests().findOne({
			accountId: file.accountId,
			assetId: { $in: assetIds },
			status: { $in: OPEN_STATUSES }
		})) !== null
	);
}
