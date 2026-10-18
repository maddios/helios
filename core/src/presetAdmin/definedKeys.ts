export function definedKeys<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}
