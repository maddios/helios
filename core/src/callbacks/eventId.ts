import { createHash } from "node:crypto";
import type { CallbackMessage } from "../pipeline";

export function callbackEventId(message: CallbackMessage): string {
	const suffix = message.type === "item" ? message.itemId : "final";
	return createHash("sha256").update(`${message.requestId}:${suffix}`).digest("hex");
}
