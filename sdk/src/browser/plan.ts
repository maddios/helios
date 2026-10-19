import { BrowserUploadError } from "./errors.js";
import type { MultipartUpload, UploadedPart } from "./types.js";

/** A part of the file, with the byte range it covers and its presigned URL. */
export interface PlannedPart {
	partNumber: number;
	url: string;
	start: number;
	end: number;
	sizeBytes: number;
}

/**
 * Cuts the file into the parts the upload planned, and checks that the upload lists exactly those parts.
 *
 * @param file The file to upload.
 * @param upload The multipart upload from the backend.
 * @returns The parts in part-number order.
 * @throws {BrowserUploadError} With code `invalid_upload` when the part size or the part list does not fit the file.
 */
export function planParts(file: Blob, upload: MultipartUpload): PlannedPart[] {
	const { partSizeBytes, parts } = upload;
	if (!Number.isSafeInteger(partSizeBytes) || partSizeBytes <= 0) {
		throw new BrowserUploadError("invalid_upload", "partSizeBytes must be a positive integer");
	}
	const count = Math.ceil(file.size / partSizeBytes);
	const numbers = new Set(parts.map((part) => part.partNumber));
	const fits =
		count > 0 &&
		parts.length === count &&
		numbers.size === count &&
		parts.every((part) => part.partNumber >= 1 && part.partNumber <= count);
	if (!fits) {
		throw new BrowserUploadError(
			"invalid_upload",
			`A ${file.size}-byte file needs ${count} parts of ${partSizeBytes} bytes, but the upload lists ${parts.length}`
		);
	}
	return parts
		.map(({ partNumber, url }) => {
			const start = (partNumber - 1) * partSizeBytes;
			const end = Math.min(start + partSizeBytes, file.size);
			return { partNumber, url, start, end, sizeBytes: end - start };
		})
		.sort((a, b) => a.partNumber - b.partNumber);
}

/**
 * Matches the parts storage already holds against the plan. A stored part must have the planned size.
 *
 * @param plan The planned parts.
 * @param uploaded Parts reported by `listParts`.
 * @returns The stored parts by part number.
 * @throws {BrowserUploadError} With code `invalid_resume` when a stored part is not in the plan or has another size.
 */
export function matchUploadedParts(plan: PlannedPart[], uploaded: UploadedPart[]): Map<number, UploadedPart> {
	const planned = new Map(plan.map((part) => [part.partNumber, part]));
	const matched = new Map<number, UploadedPart>();
	for (const part of uploaded) {
		if (planned.get(part.partNumber)?.sizeBytes !== part.sizeBytes) {
			throw new BrowserUploadError(
				"invalid_resume",
				`Uploaded part ${part.partNumber} does not match the planned part; abort the upload and start again`,
				{ partNumber: part.partNumber }
			);
		}
		matched.set(part.partNumber, part);
	}
	return matched;
}
