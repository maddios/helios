import { ConflictError, Helios, type PresetView, type ProfileInput } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

async function ensureBellaPreset(): Promise<PresetView> {
	try {
		return await helios.presets.clone("generic", "bella");
	} catch (err) {
		if (err instanceof ConflictError) {
			return helios.presets.get("bella");
		}
		throw err;
	}
}

const thumbnail: ProfileInput = {
	type: "image",
	name: "thumb_webp",
	priority: 20,
	isDefault: false,
	sourceTypes: ["video"],
	children: [],
	output: "thumb.webp",
	params: { format: "webp", quality: 80 }
};

let preset = await ensureBellaPreset();

try {
	preset = await helios.presets.addProfile("bella", { expectedVersion: preset.version, profile: thumbnail });
} catch (err) {
	if (!(err instanceof ConflictError)) {
		throw err;
	}
	preset = await helios.presets.get("bella");
	console.log(`bella changed to version ${preset.version}; re-apply the change to it`);
}

preset = await helios.presets.updateProfile("bella", "thumb_webp", {
	expectedVersion: preset.version,
	priority: 5
});

console.log(
	preset.name,
	preset.version,
	preset.profiles.map((profile) => profile.name)
);
