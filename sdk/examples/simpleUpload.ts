import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const { file, request } = await helios.uploads.upload(requireEnv("MEDIA_PATH"), {
	contentType: "video/mp4",
	encode: { preset: "generic" },
	onProgress: ({ uploadedBytes, totalBytes }) => console.log(`uploaded ${uploadedBytes} of ${totalBytes} bytes`)
});

const done = await helios.requests.wait(request!.id, { timeoutMs: 10 * 60_000 });
if (done.status === "ERROR") {
	throw new Error(`Encode failed (${done.error?.code}): ${done.error?.message}`);
}

console.log(file.id, request!.assetId, done.status);
