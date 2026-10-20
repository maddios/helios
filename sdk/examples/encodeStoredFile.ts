import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const request = await helios.encodes.create({
	source: { fileId: requireEnv("FILE_ID") },
	preset: "generic"
});

const done = await helios.requests.wait(request.id, { timeoutMs: 10 * 60_000 });
console.log(request.assetId, done.status);
