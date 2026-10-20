import { NotFoundError, UnprocessableError } from "@helios/contracts";
import { files, type FileRecord } from "../models";

export async function loadFileRecord(fileId: string): Promise<FileRecord | null> {
	return files().findOne({ _id: fileId });
}

export async function loadFile(accountId: string, fileId: string): Promise<FileRecord> {
	const file = await files().findOne({ _id: fileId, accountId, deletedAt: { $exists: false } });
	if (file === null) {
		throw new NotFoundError(`File ${fileId} not found`);
	}
	return file;
}

export async function loadStoredFile(accountId: string, fileId: string): Promise<FileRecord> {
	const file = await loadFile(accountId, fileId);
	if (file.status !== "STORED") {
		throw new UnprocessableError(`File ${fileId} is not stored`, { status: file.status }, "file_not_stored");
	}
	return file;
}
