import { Helios, UnprocessableError } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

await helios.account.setUploadPolicy({ allowedContentTypes: ["image/*", "video/mp4"], maxBytes: 5 * 1024 ** 3 });

try {
	await helios.uploads.upload(requireEnv("MEDIA_PATH"), {
		contentType: "image/png",
		policy: { allowedContentTypes: ["image/png"], maxBytes: 10 * 1024 ** 2 },
		store: true
	});
} catch (err) {
	if (err instanceof UnprocessableError) {
		console.log("rejected by policy:", err.code, err.message);
	} else {
		throw err;
	}
}
