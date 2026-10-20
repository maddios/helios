import type { Filter } from "mongodb";
import { findPage, type Page } from "../pagination";
import { files, type FileRecord } from "../models";

export interface ListFilesInput {
	externalId?: string;
	contentTypePrefix?: string;
	limit?: number;
	cursor?: string;
}

export async function listFiles(accountId: string, input: ListFilesInput): Promise<Page<FileRecord>> {
	const filter: Filter<FileRecord> = {
		accountId,
		deletedAt: { $exists: false },
		...(input.externalId !== undefined && { externalId: input.externalId }),
		...(input.contentTypePrefix !== undefined && {
			contentType: { $gte: input.contentTypePrefix, $lt: `${input.contentTypePrefix}￿` }
		})
	};
	return findPage(files(), filter, input);
}
