import { objectStore } from "../storage";
import type { FileRecord } from "../models";
import { variantPrefix } from "./keys";

/** Removes a file's object, its multipart upload and its cached variants. Safe to run more than once. */
export async function releaseFileObjects(file: FileRecord): Promise<void> {
	const store = objectStore();
	if (file.uploadId !== undefined && (await store.objectInfo(file.key)) === undefined) {
		await store.abortMultipartUpload(file.key, file.uploadId);
	}
	const variants = await store.listKeys(variantPrefix(file.key));
	await store.deleteKeys([file.key, ...variants]);
}
