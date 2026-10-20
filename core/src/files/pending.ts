const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function pendingExpiresAt(now: Date): Date {
	return new Date(now.getTime() + PENDING_TTL_MS);
}
