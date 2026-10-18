import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { DeleteObjectsCommand, GetObjectCommand, paginateListObjectsV2, type S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStore } from "./types";

const DELETE_BATCH_SIZE = 1000;

export class S3ObjectStore implements ObjectStore {
	constructor(
		private readonly client: S3Client,
		private readonly mediaBucket: string
	) {}

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
}
