import type { Readable } from "node:stream";

export interface ObjectInfo {
	size: number;
	etag: string;
}

export interface UploadedPart {
	partNumber: number;
	etag: string;
	sizeBytes: number;
}

export interface ObjectWriteOptions {
	contentType: string;
	contentDisposition: "inline" | "attachment";
	signal?: AbortSignal;
}

export interface PresignPutOptions {
	contentType: string;
	contentDisposition: "inline" | "attachment";
	contentLength: number;
}

export interface ObjectStore {
	presignGet(bucket: string, key: string, expiresSec: number): Promise<string>;
	headObject(bucket: string, key: string): Promise<boolean>;
	uploadFile(key: string, filePath: string, contentType: string): Promise<number>;
	uploadStream(key: string, body: Readable, options: ObjectWriteOptions): Promise<number>;
	uploadText(key: string, body: string, contentType: string): Promise<void>;
	uploadBuffer(key: string, body: Buffer, contentType: string, cacheControl: string): Promise<void>;
	objectInfo(key: string): Promise<ObjectInfo | undefined>;
	readHead(key: string, bytes: number): Promise<Buffer>;
	listKeys(prefix: string): Promise<string[]>;
	downloadBuffer(key: string, signal?: AbortSignal): Promise<Buffer>;
	deleteKeys(keys: string[]): Promise<void>;
	presignPut(key: string, expiresSec: number, options: PresignPutOptions): Promise<string>;
	createMultipartUpload(key: string, options: ObjectWriteOptions): Promise<string>;
	presignPart(key: string, uploadId: string, partNumber: number, expiresSec: number): Promise<string>;
	completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
	abortMultipartUpload(key: string, uploadId: string): Promise<void>;
	listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
}
