import type { FileView } from "@helios/contracts";
import { cdnUrl } from "../cdn";
import type { FileRecord } from "../models";

export function toFileView(file: FileRecord): FileView {
	const version = file.storedAt === undefined ? undefined : Math.floor(file.storedAt.getTime() / 1000);
	return {
		id: file._id,
		key: file.key,
		url: cdnUrl(file.key, version),
		filename: file.filename,
		status: file.status,
		...(file.contentType !== undefined && { contentType: file.contentType }),
		...(file.sizeBytes !== undefined && { sizeBytes: file.sizeBytes }),
		...(file.image !== undefined && { image: file.image }),
		...(file.externalId !== undefined && { externalId: file.externalId }),
		...(file.error !== undefined && { error: file.error }),
		createdAt: file.createdAt.toISOString(),
		...(file.storedAt !== undefined && { storedAt: file.storedAt.toISOString() })
	};
}
