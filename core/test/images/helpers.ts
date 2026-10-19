export function errorCode(fn: () => unknown): string | undefined {
	try {
		fn();
	} catch (err) {
		return (err as { code?: string }).code;
	}
	return undefined;
}
