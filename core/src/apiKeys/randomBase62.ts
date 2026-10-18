import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const UNBIASED_BYTE_LIMIT = 248;

export function randomBase62(length: number): string {
	let out = "";
	while (out.length < length) {
		for (const byte of randomBytes(length)) {
			if (byte < UNBIASED_BYTE_LIMIT && out.length < length) {
				out += ALPHABET.charAt(byte % ALPHABET.length);
			}
		}
	}
	return out;
}
