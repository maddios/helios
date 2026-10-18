import { randomUUID } from "node:crypto";
import { ForbiddenError } from "@helios/contracts";

const MAX_FILENAME_LENGTH = 200;
const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export function sanitizeFilename(name: string): string {
	return name
		.replace(/[^A-Za-z0-9._-]/g, "_")
		.replace(/\.{2,}/g, "_")
		.slice(0, MAX_FILENAME_LENGTH);
}

export function uploadKey(slug: string, filename: string): string {
	return `${slug}/uploads/${randomUUID()}/${sanitizeFilename(filename)}`;
}

export function rawFileKey(slug: string, filename: string): string {
	return `${slug}/files/${randomUUID()}/${sanitizeFilename(filename)}`;
}

export function assertOwnedUploadKey(slug: string, key: string): void {
	const pattern = new RegExp(`^${slug}/uploads/${UUID_V4}/[A-Za-z0-9._-]+$`);
	if (!pattern.test(key) || key.includes("..")) {
		throw new ForbiddenError("Upload key does not belong to this account");
	}
}
