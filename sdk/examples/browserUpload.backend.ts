import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

export async function startBrowserUpload(filename: string, sizeBytes: number) {
	return helios.uploads.createMultipart({ filename, sizeBytes, contentType: "video/mp4" });
}

export async function renewBrowserParts(uploadId: string, uploadKey: string, partNumbers: number[]) {
	return helios.uploads.signParts(uploadId, uploadKey, partNumbers);
}

export async function storedBrowserParts(uploadId: string, uploadKey: string) {
	return (await helios.uploads.listParts(uploadId, uploadKey)).parts;
}

export async function finishBrowserUpload(
	uploadId: string,
	uploadKey: string,
	parts: { partNumber: number; etag: string }[]
) {
	return helios.uploads.completeMultipart(uploadId, { uploadKey, parts });
}
