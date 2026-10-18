import { Db, MongoClient, type ClientSession } from "mongodb";

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

export async function withTransaction(work: (session: ClientSession) => Promise<void>): Promise<void> {
	if (!client) {
		throw new Error("Database is not initialized");
	}
	const session = client.startSession();
	try {
		await session.withTransaction(work);
	} finally {
		await session.endSession();
	}
}

export async function closeDb(): Promise<void> {
	await client?.close();
	client = undefined;
}
