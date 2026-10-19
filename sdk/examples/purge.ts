import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const externalId = requireEnv("EXTERNAL_ID");

let cursor: string | undefined;
do {
	const page = await helios.assets.list({ externalId, cursor });
	for (const asset of page.assets) {
		const accepted = await helios.assets.delete(asset.id);
		console.log("purge accepted", accepted.assetId);
	}
	cursor = page.nextCursor;
} while (cursor !== undefined);
