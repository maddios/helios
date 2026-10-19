export interface Cdn {
	invalidationsInProgress(): Promise<number>;
	createInvalidation(paths: string[], callerReference: string): Promise<boolean>;
}
