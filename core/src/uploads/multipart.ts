import { ValidationError } from "@helios/contracts";

const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_PART_SIZE_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_PART_COUNT = 10000;

export function partSizeFor(sizeBytes: number): number {
	const partSizeBytes = Math.max(MIN_PART_SIZE_BYTES, Math.ceil(sizeBytes / MAX_PART_COUNT));
	if (partSizeBytes > MAX_PART_SIZE_BYTES) {
		throw new ValidationError("File is too large for a multipart upload", { sizeBytes });
	}
	return partSizeBytes;
}

export function partCountFor(sizeBytes: number, partSizeBytes: number): number {
	return Math.ceil(sizeBytes / partSizeBytes);
}
