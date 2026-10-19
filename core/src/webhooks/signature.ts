import { createHmac, timingSafeEqual } from "node:crypto";

const HEADER_PATTERN = /^t=(\d+),v1=([0-9a-f]+)$/;

export function signPayload(secret: string, timestamp: number, rawBody: string): string {
	return `t=${timestamp},v1=${hmacHex(secret, timestamp, rawBody)}`;
}

export function verifySignature(
	secret: string,
	header: string,
	rawBody: string,
	nowSec: number,
	toleranceSec: number
): boolean {
	const match = HEADER_PATTERN.exec(header);
	if (match === null) {
		return false;
	}
	const timestamp = Number(match[1]);
	if (Math.abs(nowSec - timestamp) > toleranceSec) {
		return false;
	}
	return equalHex(hmacHex(secret, timestamp, rawBody), match[2] ?? "");
}

function hmacHex(secret: string, timestamp: number, rawBody: string): string {
	return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function equalHex(expected: string, actual: string): boolean {
	const expectedBytes = Buffer.from(expected, "hex");
	const actualBytes = Buffer.from(actual, "hex");
	return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}
