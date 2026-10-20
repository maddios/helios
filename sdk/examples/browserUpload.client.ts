import { upload, type BrowserUpload, type PartUrl, type UploadedPart } from "@partnrup/helios-sdk/browser";

async function postJson<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body)
	});
	return (await res.json()) as T;
}

export async function uploadVideo(
	file: Blob,
	created: BrowserUpload,
	onProgress: (fraction: number) => void
): Promise<void> {
	const { parts } = await upload(created, file, {
		concurrency: 4,
		onProgress: ({ uploadedBytes, totalBytes }) => onProgress(uploadedBytes / totalBytes),
		signParts: (partNumbers) => postJson<PartUrl[]>("/api/uploads/renew", { fileId: created.fileId, partNumbers })
	});
	await postJson("/api/uploads/finish", { fileId: created.fileId, parts });
}

export async function resumeVideo(file: Blob, created: BrowserUpload): Promise<void> {
	const uploadedParts = await postJson<UploadedPart[]>("/api/uploads/stored", { fileId: created.fileId });
	const { parts } = await upload(created, file, { uploadedParts });
	await postJson("/api/uploads/finish", { fileId: created.fileId, parts });
}
