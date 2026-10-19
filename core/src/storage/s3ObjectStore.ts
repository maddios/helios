import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	paginateListObjectsV2,
	PutObjectCommand,
	type S3Client,
	UploadPartCommand
} from "@aws-sdk/client-s3";
import { S3ServiceException } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectInfo, ObjectStore } from "./types";

const DELETE_BATCH_SIZE = 1000;

export class S3ObjectStore implements ObjectStore {
	constructor(
		private readonly client: S3Client,
		private readonly mediaBucket: string
	) {}

	async headObject(bucket: string, key: string): Promise<boolean> {
		try {
			await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
			return true;
		} catch (err) {
			if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) {
				return false;
			}
			throw err;
		}
	}

	presignGet(bucket: string, key: string, expiresSec: number): Promise<string> {
		return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresSec });
	}

	async uploadFile(key: string, filePath: string, contentType: string): Promise<number> {
		const { size } = await stat(filePath);
		await new Upload({
			client: this.client,
			params: { Bucket: this.mediaBucket, Key: key, Body: createReadStream(filePath), ContentType: contentType }
		}).done();
		return size;
	}

	async uploadStream(key: string, body: Readable, contentType: string): Promise<number> {
		let bytes = 0;
		const counter = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				bytes += chunk.length;
				callback(null, chunk);
			}
		});
		const upload = new Upload({
			client: this.client,
			params: { Bucket: this.mediaBucket, Key: key, Body: counter, ContentType: contentType }
		}).done();
		try {
			await Promise.all([upload, pipeline(body, counter)]);
		} catch (err) {
			body.destroy();
			throw err;
		}
		return bytes;
	}

	async uploadText(key: string, body: string, contentType: string): Promise<void> {
		await this.client.send(
			new PutObjectCommand({ Bucket: this.mediaBucket, Key: key, Body: body, ContentType: contentType })
		);
	}

	async uploadBuffer(key: string, body: Buffer, contentType: string, cacheControl: string): Promise<void> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.mediaBucket,
				Key: key,
				Body: body,
				ContentType: contentType,
				CacheControl: cacheControl
			})
		);
	}

	async objectInfo(key: string): Promise<ObjectInfo | undefined> {
		try {
			const { ContentLength = 0, ETag = "" } = await this.client.send(
				new HeadObjectCommand({ Bucket: this.mediaBucket, Key: key })
			);
			return { size: ContentLength, etag: ETag };
		} catch (err) {
			if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) {
				return undefined;
			}
			throw err;
		}
	}

	async downloadBuffer(key: string, signal?: AbortSignal): Promise<Buffer> {
		const response = await this.client.send(new GetObjectCommand({ Bucket: this.mediaBucket, Key: key }), {
			abortSignal: signal
		});
		if (response.Body === undefined) {
			throw new Error(`Object ${key} has no body`);
		}
		return Buffer.from(await response.Body.transformToByteArray());
	}

	async listKeys(prefix: string): Promise<string[]> {
		const keys: string[] = [];
		for await (const page of paginateListObjectsV2(
			{ client: this.client },
			{ Bucket: this.mediaBucket, Prefix: prefix }
		)) {
			for (const object of page.Contents ?? []) {
				if (object.Key !== undefined) {
					keys.push(object.Key);
				}
			}
		}
		return keys;
	}

	async deleteKeys(keys: string[]): Promise<void> {
		for (let start = 0; start < keys.length; start += DELETE_BATCH_SIZE) {
			const batch = keys.slice(start, start + DELETE_BATCH_SIZE);
			const { Errors = [] } = await this.client.send(
				new DeleteObjectsCommand({
					Bucket: this.mediaBucket,
					Delete: { Objects: batch.map((Key) => ({ Key })) }
				})
			);
			if (Errors.length > 0) {
				throw new Error(`Failed to delete ${Errors.length} object(s): ${Errors.map((e) => e.Key).join(", ")}`);
			}
		}
	}

	presignPut(key: string, expiresSec: number, contentType?: string): Promise<string> {
		return getSignedUrl(
			this.client,
			new PutObjectCommand({ Bucket: this.mediaBucket, Key: key, ContentType: contentType }),
			{ expiresIn: expiresSec }
		);
	}

	async createMultipartUpload(key: string, contentType?: string): Promise<string> {
		const { UploadId } = await this.client.send(
			new CreateMultipartUploadCommand({ Bucket: this.mediaBucket, Key: key, ContentType: contentType })
		);
		if (UploadId === undefined) {
			throw new Error(`S3 did not return an UploadId for ${key}`);
		}
		return UploadId;
	}

	presignPart(key: string, uploadId: string, partNumber: number, expiresSec: number): Promise<string> {
		return getSignedUrl(
			this.client,
			new UploadPartCommand({ Bucket: this.mediaBucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
			{ expiresIn: expiresSec }
		);
	}

	async completeMultipartUpload(
		key: string,
		uploadId: string,
		parts: { partNumber: number; etag: string }[]
	): Promise<void> {
		await this.client.send(
			new CompleteMultipartUploadCommand({
				Bucket: this.mediaBucket,
				Key: key,
				UploadId: uploadId,
				MultipartUpload: { Parts: parts.map(({ partNumber, etag }) => ({ PartNumber: partNumber, ETag: etag })) }
			})
		);
	}

	async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
		await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.mediaBucket, Key: key, UploadId: uploadId }));
	}
}
