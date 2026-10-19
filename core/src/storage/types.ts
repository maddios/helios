import type { Readable } from "node:stream";

export interface ObjectStore {
	presignGet(bucket: string, key: string, expiresSec: number): Promise<string>;
	headObject(bucket: string, key: string): Promise<boolean>;
	uploadFile(key: string, filePath: string, contentType: string): Promise<number>;
	uploadStream(key: string, body: Readable, contentType: string): Promise<number>;
	uploadText(key: string, body: string, contentType: string): Promise<void>;
	listKeys(prefix: string): Promise<string[]>;
	downloadBuffer(key: string, signal?: AbortSignal): Promise<Buffer>;
	deleteKeys(keys: string[]): Promise<void>;
	presignPut(key: string, expiresSec: number, contentType?: string): Promise<string>;
	createMultipartUpload(key: string, contentType?: string): Promise<string>;
	presignPart(key: string, uploadId: string, partNumber: number, expiresSec: number): Promise<string>;
	completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
	abortMultipartUpload(key: string, uploadId: string): Promise<void>;
}
