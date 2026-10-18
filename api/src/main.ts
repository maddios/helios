import { closeDb, config, ensureIndexes, initDb, logger } from "@helios/core";
import { createApp } from "./app";
import { apiConfig } from "./config";
import { closeServer } from "./shutdown";

const KEEP_ALIVE_MS = 65_000;
const HEADERS_TIMEOUT_MS = KEEP_ALIVE_MS + 1_000;

export async function main(): Promise<void> {
	const { API_PORT, SHUTDOWN_DRAIN_SEC } = apiConfig();
	await initDb(config().MONGO_URI);
	await ensureIndexes();
	const server = createApp().listen(API_PORT, () => {
		logger().info({ port: API_PORT }, "helios api listening");
	});
	server.keepAliveTimeout = KEEP_ALIVE_MS;
	server.headersTimeout = HEADERS_TIMEOUT_MS;
	const shutdown = (): void => {
		void closeServer(server, SHUTDOWN_DRAIN_SEC * 1000)
			.then(() => closeDb())
			.then(() => process.exit(0));
	};
	process.once("SIGTERM", shutdown);
	process.once("SIGINT", shutdown);
}

if (require.main === module) {
	main().catch((err: unknown) => {
		console.error(err);
		process.exitCode = 1;
	});
}
