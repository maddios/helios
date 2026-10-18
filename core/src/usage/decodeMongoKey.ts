const DECODED_CODES: Record<string, string> = { "%25": "%", "%2E": ".", "%24": "$" };

export function decodeMongoKey(key: string): string {
	return key.replace(/%(25|2E|24)/g, (code) => DECODED_CODES[code]);
}
