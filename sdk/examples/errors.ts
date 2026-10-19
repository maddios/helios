import {
	ConflictError,
	Helios,
	HeliosError,
	RateLimitError,
	TimeoutError,
	UploadEncodeError
} from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

try {
	const { request } = await helios.uploads.uploadAndEncode(requireEnv("MEDIA_PATH"), { preset: "generic" });
	await helios.requests.wait(request.id, { timeoutMs: 10 * 60_000 });
} catch (err) {
	if (err instanceof UploadEncodeError) {
		console.log("upload stored as", err.uploadKey, "- encode it again without re-uploading");
	} else if (err instanceof RateLimitError) {
		console.log("rate limited for", err.retryAfterMs, "ms");
	} else if (err instanceof ConflictError) {
		console.log("conflict", err.code);
	} else if (err instanceof TimeoutError) {
		console.log("still running; keep the request id and poll later");
	} else if (err instanceof HeliosError) {
		console.error(err.code, err.status, err.requestId);
	} else {
		throw err;
	}
}
