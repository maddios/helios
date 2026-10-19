import { config, initDb } from "@helios/core";

let connecting: Promise<void> | undefined;

export function connectOnce(): Promise<void> {
	connecting ??= initDb(config().MONGO_URI).catch((err: unknown) => {
		connecting = undefined;
		throw err;
	});
	return connecting;
}
