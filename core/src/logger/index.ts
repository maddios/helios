import pino, { type Logger } from "pino";
import { config } from "../config";

export type LogContext = {
	accountId?: string;
	requestId?: string;
	itemId?: string;
	assetId?: string;
};

let base: Logger | undefined;

export function logger(): Logger {
	base ??= pino({ level: config().LOG_LEVEL, base: { service: "helios" } });
	return base;
}

export function contextLogger(ctx: LogContext): Logger {
	return logger().child(ctx);
}

export function toMessageAttributes(ctx: LogContext): Record<string, string> {
	return Object.fromEntries(Object.entries(ctx).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

export function fromMessageAttributes(attrs: Record<string, string | undefined>): LogContext {
	return {
		accountId: attrs.accountId,
		requestId: attrs.requestId,
		itemId: attrs.itemId,
		assetId: attrs.assetId
	};
}
