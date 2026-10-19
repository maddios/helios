import { PayloadTooLargeError } from "./errors";
import type { Envelope } from "./senders/types";

export const MAX_PAYLOAD_BYTES = 256 * 1024;

export function assertPayloadSize(envelope: Envelope): void {
	const bytes = Buffer.byteLength(JSON.stringify(envelope));
	if (bytes >= MAX_PAYLOAD_BYTES) {
		throw new PayloadTooLargeError(bytes);
	}
}
