import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL"),
	imageBaseUrl: requireEnv("HELIOS_IMAGE_BASE_URL")
});

const { file } = await helios.uploads.upload(requireEnv("MEDIA_PATH"), {
	contentType: "image/png",
	externalId: "logo-42",
	store: true
});

const thumbnail = helios.images.url(file.key, { w: 320, h: 180 });
console.log(file.id, file.url, file.image, thumbnail);
