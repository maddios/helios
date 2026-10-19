import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL"),
	imageBaseUrl: requireEnv("HELIOS_IMAGE_BASE_URL")
});

const assetId = requireEnv("ASSET_ID");
const asset = await helios.assets.get(assetId);
const { scenes, summary } = await helios.assets.scenes(assetId);

const stills = asset.outputs.stills?.items ?? [];
const scene = scenes[0];
const still = stills[scene.representativeStill.index];
if (still === undefined) {
	throw new Error(`Scene ${scene.sceneNumber} has no still`);
}

const cover = helios.images.url(still.key, { w: 320, h: 180, c: "fill", g: "center", f: "webp", q: 85 }, asset.version);
const thumb = helios.images.url(still.key, { w: 160, q: 80 });

console.log(summary.title, cover, thumb);
