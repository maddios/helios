import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const pending = await helios.files.fromUrl({ url: "https://example.com/logo.png", externalId: "logo-42" });

let file = pending;
while (file.status === "PENDING") {
	await new Promise((resolve) => setTimeout(resolve, 2_000));
	file = await helios.files.get(pending.id);
}

console.log(file.status, file.url, file.error);
