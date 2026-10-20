import { createHash } from "node:crypto";
import type { CallbackMessage } from "../pipeline";

export function callbackEventId(message: CallbackMessage): string {
	return createHash("sha256").update(eventKey(message)).digest("hex");
}

function eventKey(message: CallbackMessage): string {
	switch (message.type) {
		case "item":
			return `${message.requestId}:${message.itemId}`;
		case "request":
			return `${message.requestId}:final`;
		case "file":
			return `file:${message.fileId}:${message.event}`;
	}
}
