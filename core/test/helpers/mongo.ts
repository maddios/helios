import path from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { closeDb, db, initDb } from "../../src/db";

let server: MongoMemoryReplSet | undefined;

export async function startMongo(): Promise<void> {
	process.env.MONGOMS_DOWNLOAD_DIR = path.resolve(__dirname, "../../../.cache/mongodb-binaries");
	server = await MongoMemoryReplSet.create({
		replSet: { count: 1 },
		instanceOpts: [{ args: ["--wiredTigerCacheSizeGB", "0.25"] }]
	});
	await initDb(server.getUri());
}

export async function stopMongo(): Promise<void> {
	await closeDb();
	await server?.stop();
	server = undefined;
}

export async function resetDb(): Promise<void> {
	await db().dropDatabase();
}
