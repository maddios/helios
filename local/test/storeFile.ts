import type { CompleteUploadResponse, CreateUploadResponse } from "@helios/contracts";

export type AccountCall = (method: string, urlPath: string, body?: unknown) => Promise<{ status: number; body?: any }>;

const MiB = 1024 * 1024;
const PART_BYTES = 5 * MiB;

/**
 * Stores a file through the API the way a client does: create the upload, PUT the bytes (one PUT, or one per part),
 * then complete it with `store: true`.
 */
export async function storeFile(
	call: AccountCall,
	bytes: Buffer,
	filename: string,
	contentType: string
): Promise<CompleteUploadResponse> {
	const created = await call("POST", "/uploads", { filename, sizeBytes: bytes.length, contentType });
	const upload = created.body as CreateUploadResponse;
	if (upload.mode === "single") {
		await putBytes(upload.url, bytes, upload.headers);
		return completeStored(call, upload.fileId, undefined);
	}
	const parts = [];
	for (const part of upload.parts) {
		const start = (part.partNumber - 1) * PART_BYTES;
		const etag = await putBytes(part.url, bytes.subarray(start, start + PART_BYTES));
		parts.push({ partNumber: part.partNumber, etag });
	}
	return completeStored(call, upload.fileId, parts);
}

async function completeStored(
	call: AccountCall,
	fileId: string,
	parts: { partNumber: number; etag: string }[] | undefined
): Promise<CompleteUploadResponse> {
	const done = await call("POST", `/uploads/${fileId}/complete`, {
		...(parts !== undefined && { parts }),
		store: true
	});
	if (done.status !== 200) {
		throw new Error(`Completing ${fileId} answered ${done.status}`);
	}
	return done.body as CompleteUploadResponse;
}

async function putBytes(url: string, bytes: Buffer, headers: Record<string, string> = {}): Promise<string> {
	const res = await fetch(url, { method: "PUT", body: bytes, headers });
	if (res.status !== 200) {
		throw new Error(`Storage answered ${res.status} to a PUT`);
	}
	return res.headers.get("etag") ?? "";
}
