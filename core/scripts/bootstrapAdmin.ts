import { applyLocalEnv, loadLocalConfig } from "../../local/loadConfig";
import { bootstrapAdminKey, closeDb, config, ensureIndexes, initDb } from "../src";

async function main(): Promise<void> {
	if (process.argv.includes("--local")) {
		applyLocalEnv(loadLocalConfig(), { e2e: false });
	}
	await initDb(config().MONGO_URI);
	try {
		await ensureIndexes();
		const key = await bootstrapAdminKey();
		console.log("Admin key (shown once):");
		console.log(key);
	} finally {
		await closeDb();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
