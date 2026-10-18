import { ValidationError } from "@helios/contracts";
import { config } from "../config";

export function assertWithinUploadLimit(sizeBytes: number): void {
	const { MAX_UPLOAD_BYTES } = config();
	if (sizeBytes > MAX_UPLOAD_BYTES) {
		throw new ValidationError(`Upload exceeds the ${MAX_UPLOAD_BYTES}-byte limit`, { sizeBytes, MAX_UPLOAD_BYTES });
	}
}
