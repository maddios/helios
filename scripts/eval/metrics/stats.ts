export function ratio(part: number, whole: number): number {
	return whole === 0 ? 0 : part / whole;
}

export function average(values: (number | null)[]): number | null {
	const present = values.filter((value): value is number => value !== null);
	return present.length === 0 ? null : present.reduce((total, value) => total + value, 0) / present.length;
}
