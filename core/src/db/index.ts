import { Db, MongoClient } from "mongodb";

const DB_NAME = "helios";

let client: MongoClient | undefined;

export async function initDb(uri: string): Promise<void> {
	if (client) {
		return;
	}
	client = await MongoClient.connect(uri);
}

export function db(): Db {
	if (!client) {
		throw new Error("Database is not initialized");
	}
	return client.db(DB_NAME);
}

export async function closeDb(): Promise<void> {
	await client?.close();
	client = undefined;
}
