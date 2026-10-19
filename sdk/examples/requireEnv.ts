export function requireEnv(name: string): string {
	const value = process.env[name];
	if (value === undefined || value === "") {
		throw new Error(`Environment variable ${name} is required`);
	}
	return value;
}
