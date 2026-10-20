const MAX_FILENAME_LENGTH = 200;

export function sanitizeFilename(name: string): string {
	return name
		.replace(/[^A-Za-z0-9._-]/g, "_")
		.replace(/^\.+/, "_")
		.replace(/\.{2,}/g, "_")
		.slice(0, MAX_FILENAME_LENGTH);
}

export function fileKey(slug: string, fileId: string, filename: string): string {
	return `${slug}/files/${fileId}/${sanitizeFilename(filename)}`;
}

export function variantPrefix(key: string): string {
	return `resize_cache/${key}/`;
}
