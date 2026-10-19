import { ConflictError, Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

try {
	const cancelled = await helios.requests.cancel(requireEnv("REQUEST_ID"));
	console.log(cancelled.status);
} catch (err) {
	if (err instanceof ConflictError) {
		console.log("the request already finished");
	} else {
		throw err;
	}
}
