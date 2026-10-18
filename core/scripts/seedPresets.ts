import { applyLocalEnv, loadLocalConfig } from "../../local/loadConfig";
import { closeDb, config, ensureIndexes, genericPreset, initDb, seedSystemPreset } from "../src";

async function main(): Promise<void> {
	if (process.argv.includes("--local")) {
		applyLocalEnv(loadLocalConfig(), { e2e: false });
	}
	await initDb(config().MONGO_URI);
	try {
		await ensureIndexes();
		const result = await seedSystemPreset(genericPreset);
		console.log(`generic: ${result}`);
	} finally {
		await closeDb();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
