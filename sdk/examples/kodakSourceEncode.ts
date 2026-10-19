import { Helios, type EncodeRequest } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const body: EncodeRequest = {
	source: { bucket: requireEnv("KODAK_SOURCE_BUCKET"), key: requireEnv("KODAK_SOURCE_KEY") },
	preset: "generic",
	externalId: "bella-clip-42",
	postProcess: { transcribe: { translations: ["es"] }, sceneDetection: true },
	analyze: "async"
};

const plan = await helios.encodes.create({ ...body, analyze: "sync" }, { dryRun: true });
console.log(plan.items.map((item) => item.key));

const request = await helios.encodes.create(body);
console.log(request.id, request.status);
