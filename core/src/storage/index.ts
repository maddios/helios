import { S3Client } from "@aws-sdk/client-s3";
import { config } from "../config";
import { S3ObjectStore } from "./s3ObjectStore";
import type { ObjectStore } from "./types";

export * from "./types";
export { S3ObjectStore };

let store: ObjectStore | undefined;

export function objectStore(): ObjectStore {
	if (store === undefined) {
		const { AWS_REGION, S3_ENDPOINT, MEDIA_BUCKET } = config();
		const client = new S3Client({
			region: AWS_REGION,
			endpoint: S3_ENDPOINT,
			forcePathStyle: S3_ENDPOINT !== undefined
		});
		store = new S3ObjectStore(client, MEDIA_BUCKET);
	}
	return store;
}

export function resetObjectStoreForTests(): void {
	store = undefined;
}
