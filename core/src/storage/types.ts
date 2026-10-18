export interface ObjectStore {
	presignGet(bucket: string, key: string, expiresSec: number): Promise<string>;
	uploadFile(key: string, filePath: string, contentType: string): Promise<number>;
	listKeys(prefix: string): Promise<string[]>;
	deleteKeys(keys: string[]): Promise<void>;
}
