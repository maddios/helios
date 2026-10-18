export function expiresAtIso(expiresSec: number): string {
	return new Date(Date.now() + expiresSec * 1000).toISOString();
}
