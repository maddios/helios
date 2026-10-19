import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const assetId = requireEnv("ASSET_ID");

const accepted = await helios.assets.postProcess(assetId, {
	postProcess: { transcribe: { translations: ["es", "fr"] } }
});
const done = await helios.requests.wait(accepted.id);
if (done.status === "ERROR") {
	throw new Error(`Post-processing failed (${done.error?.code}): ${done.error?.message}`);
}

const { transcripts } = await helios.assets.transcripts(assetId);
for (const transcript of transcripts) {
	console.log(transcript.language, transcript.isTranslation, transcript.urls.vtt);
}
