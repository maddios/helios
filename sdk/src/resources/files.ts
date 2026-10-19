import type { FileUploadRequest, FileUploadResponse } from "@helios/contracts";
import type { Transport } from "../transport/transport.js";

/**
 * Presigns uploads of raw, non-media files (for example captions or documents) that are not encoded.
 *
 * @example
 * const { uploadUrl, url } = await helios.files.create({ filename: "brief.pdf", contentType: "application/pdf" });
 */
export class Files {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Gets a presigned PUT URL for a raw file. Once uploaded, the file is served at `url`.
	 *
	 * @param request Filename and optional content type.
	 * @returns The file key, the presigned upload URL, the CDN url and the URL's expiry.
	 * @throws {ValidationError} When the filename is empty or too long (400).
	 * @example
	 * const file = await helios.files.create({ filename: "brief.pdf" });
	 */
	create(request: FileUploadRequest): Promise<FileUploadResponse> {
		return this.transport.json<FileUploadResponse>({
			method: "POST",
			retry: "rateLimitOnly",
			path: "/files",
			body: request
		});
	}
}
