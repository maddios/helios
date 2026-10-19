import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const request = await helios.encodes.reencode(requireEnv("ASSET_ID"), { refreshPreset: true });
const done = await helios.requests.wait(request.id);

console.log(done.status, done.assetVersion, done.postProcess);
