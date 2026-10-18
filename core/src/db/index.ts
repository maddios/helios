import {
	Db,
	MongoBulkWriteError,
	MongoClient,
	MongoNetworkError,
	MongoNotConnectedError,
	MongoServerError,
	MongoServerSelectionError,
	MongoTopologyClosedError,
	type ClientSession
} from "mongodb";

export {
	MongoNetworkError,
	MongoNetworkTimeoutError,
	MongoNotConnectedError,
	MongoServerSelectionError,
	MongoTopologyClosedError
} from "mongodb";

const DB_NAME = "helios";
const DUPLICATE_KEY_CODE = 11000;

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

export function isDuplicateKeyError(err: unknown): boolean {
	return err instanceof MongoServerError && err.code === DUPLICATE_KEY_CODE;
}

export function isOnlyDuplicateKeyError(err: unknown): boolean {
	if (!(err instanceof MongoBulkWriteError)) {
		return false;
	}
	const writeErrors = Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors];
	return writeErrors.every((writeError) => writeError.code === DUPLICATE_KEY_CODE);
}

export async function pingDatabase(): Promise<void> {
	await db().command({ ping: 1 });
}

export function isDatabaseUnavailableError(err: unknown): boolean {
	return (
		err instanceof MongoNetworkError ||
		err instanceof MongoServerSelectionError ||
		err instanceof MongoNotConnectedError ||
		err instanceof MongoTopologyClosedError
	);
}
