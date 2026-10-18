import type { ItemKind } from "@helios/contracts";
import { encodeHandler } from "./encode";
import type { ItemHandler } from "./types";

export class NoHandlerError extends Error {
	constructor(kind: ItemKind) {
		super(`No handler registered for item kind "${kind}"`);
		this.name = "NoHandlerError";
	}
}

const handlers: Partial<Record<ItemKind, ItemHandler>> = {
	encode: encodeHandler
};

export function handlerFor(kind: ItemKind): ItemHandler {
	const handler = handlers[kind];
	if (handler === undefined) {
		throw new NoHandlerError(kind);
	}
	return handler;
}
