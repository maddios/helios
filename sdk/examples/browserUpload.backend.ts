import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

export async function startBrowserUpload(filename: string, sizeBytes: number) {
	return helios.uploads.create({ filename, sizeBytes, contentType: "video/mp4" });
}

export async function renewBrowserParts(fileId: string, partNumbers: number[]) {
	return (await helios.uploads.signParts(fileId, partNumbers)).parts;
}

export async function storedBrowserParts(fileId: string) {
	return (await helios.uploads.listParts(fileId)).parts;
}

export async function finishBrowserUpload(fileId: string, parts: { partNumber: number; etag: string }[]) {
	return helios.uploads.complete(fileId, { parts, store: true });
}

export async function finishBrowserUploadAndEncode(fileId: string, parts: { partNumber: number; etag: string }[]) {
	return helios.uploads.complete(fileId, { parts, encode: { preset: "generic" } });
}

export async function abandonBrowserUpload(fileId: string) {
	return helios.uploads.abort(fileId);
}
