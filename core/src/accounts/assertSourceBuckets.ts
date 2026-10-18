import { ValidationError } from "@helios/contracts";
import { config } from "../config";

export function assertSourceBuckets(buckets: string[]): void {
	if (buckets.includes(config().MEDIA_BUCKET)) {
		throw new ValidationError("sourceBuckets must not include the media bucket");
	}
}
