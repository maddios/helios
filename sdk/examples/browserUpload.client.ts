import { uploadParts, type MultipartUpload, type PartUrl, type UploadedPart } from "@partnrup/helios-sdk/browser";

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
	upload: MultipartUpload,
	onProgress: (fraction: number) => void
): Promise<void> {
	const uploadedParts = await postJson<UploadedPart[]>("/api/uploads/stored", upload);
	const parts = await uploadParts(upload, file, {
		concurrency: 4,
		uploadedParts,
		onProgress: ({ uploadedBytes, totalBytes }) => onProgress(uploadedBytes / totalBytes),
		signParts: (partNumbers) => postJson<PartUrl[]>("/api/uploads/renew", { ...upload, partNumbers })
	});
	await postJson("/api/uploads/finish", { ...upload, parts });
}
