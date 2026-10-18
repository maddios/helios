import { closeDb, config as coreConfig, initDb } from "@helios/core";
import { runWorker } from "./pollLoop";

export async function main(): Promise<void> {
	await initDb(coreConfig().MONGO_URI);
	const controller = new AbortController();
	const stop = () => controller.abort(new Error("Worker stopping"));
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	try {
		await runWorker({ signal: controller.signal });
	} finally {
		await closeDb();
	}
}

if (require.main === module) {
	main().catch((err: unknown) => {
		console.error(err);
		process.exitCode = 1;
	});
}
