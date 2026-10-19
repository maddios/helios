import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const usage = await helios.usage.get({ from: requireEnv("USAGE_FROM"), to: requireEnv("USAGE_TO") });

console.log(usage.requests, usage.units.lambdaGbSeconds, usage.units.outputGb);
for (const day of usage.days) {
	console.log(day.date, day.requests, day.units.transcriptionAudioSeconds);
}
