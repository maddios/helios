import type { FileDeletedResponse, FileFromUrlRequest, FileListQuery, FileListResponse, FileView } from "../types.js";
import type { Transport } from "../transport/transport.js";

/**
 * Lists, reads and deletes stored files, and stores files fetched from a public URL.
 *
 * @example
 * const { files } = await helios.files.list({ externalId: "logo-42" });
 */
export class Files {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Lists files, newest first. Deleted files are not listed.
	 *
	 * @param query Page size, cursor, and filters by externalId or content type prefix.
	 * @returns A page of files and the cursor of the next page, when there is one.
	 * @example
	 * const page = await helios.files.list({ contentTypePrefix: "image/", limit: 50 });
	 */
	list(query: FileListQuery = {}): Promise<FileListResponse> {
		return this.transport.json<FileListResponse>({
			method: "GET",
			retry: "idempotent",
			path: "/files",
			query
		});
	}

	/**
	 * Gets a file with its CDN url. Image files can be transformed through the `images` helper.
	 *
	 * @param id File id.
	 * @returns The file.
	 * @throws {NotFoundError} When the file does not exist or was deleted (404).
	 * @example
	 * const file = await helios.files.get(fileId);
	 */
	get(id: string): Promise<FileView> {
		return this.transport.json<FileView>({
			method: "GET",
			retry: "idempotent",
			path: `/files/${encodeURIComponent(id)}`
		});
	}

	/**
	 * Deletes a file: its object, its cached image variants and its CDN copies. The file is gone from the API at once.
	 *
	 * @param id File id.
	 * @returns The id of the deleted file.
	 * @throws {NotFoundError} When the file does not exist or was already deleted (404).
	 * @example
	 * await helios.files.delete(fileId);
	 */
	delete(id: string): Promise<FileDeletedResponse> {
		return this.transport.json<FileDeletedResponse>({
			method: "DELETE",
			retry: "idempotent",
			path: `/files/${encodeURIComponent(id)}`
		});
	}

	/**
	 * Stores a file that Helios fetches from a public URL. The file is PENDING until the fetch finishes; the webhook then
	 * receives `file.stored` or `file.failed`.
	 *
	 * @param request The public http(s) URL, and an optional filename and externalId.
	 * @returns The PENDING file.
	 * @throws {ValidationError} When the URL or filename is invalid (400).
	 * @example
	 * const pending = await helios.files.fromUrl({ url: "https://example.com/logo.png", externalId: "logo-42" });
	 */
	fromUrl(request: FileFromUrlRequest): Promise<FileView> {
		return this.transport.json<FileView>({
			method: "POST",
			retry: "rateLimitOnly",
			path: "/files/from-url",
			body: request
		});
	}
}
