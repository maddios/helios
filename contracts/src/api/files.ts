import { z } from "zod";
import { CallbackUrlSchema, PaginationQuerySchema } from "./common";
import { filenameField } from "./filename";
import { DestinationInputSchema } from "../destinations";

export const FileStatusSchema = z
	.enum(["PENDING", "STORED", "FAILED"])
	.describe("PENDING until the upload completes, STORED when usable, FAILED when rejected or expired");
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const FileImageSchema = z
	.object({
		width: z.int().positive().describe("Display width in pixels, after EXIF rotation"),
		height: z.int().positive().describe("Display height in pixels, after EXIF rotation"),
		format: z.string().describe("Image format detected from the file bytes, such as png or jpg")
	})
	.meta({ id: "FileImage" });
export type FileImage = z.infer<typeof FileImageSchema>;

export const FileViewSchema = z
	.object({
		id: z.string().describe("File id"),
		key: z.string().describe("Storage key of the file"),
		url: z.url().describe("CDN URL the file is served from"),
		filename: z.string().describe("Sanitized original filename"),
		status: FileStatusSchema,
		contentType: z.string().optional().describe("MIME type detected from the bytes once the file is stored"),
		sizeBytes: z.int().nonnegative().optional().describe("Size of the stored file in bytes"),
		image: FileImageSchema.optional().describe("Dimensions of an image file"),
		externalId: z.string().optional().describe("Caller-side identifier for the file"),
		error: z.string().optional().describe("Why the file failed, when status is FAILED"),
		createdAt: z.iso.datetime().describe("When the file record was created"),
		storedAt: z.iso.datetime().optional().describe("When the file became STORED")
	})
	.meta({
		id: "File",
		example: {
			id: "0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601",
			key: "acme/files/0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601/logo.png",
			url: "https://cdn.example.test/acme/files/0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601/logo.png?v=1760000000",
			filename: "logo.png",
			status: "STORED",
			contentType: "image/png",
			sizeBytes: 48213,
			image: { width: 1200, height: 630, format: "png" },
			createdAt: "2026-10-19T09:00:00.000Z",
			storedAt: "2026-10-19T09:00:04.000Z"
		}
	});
export type FileView = z.infer<typeof FileViewSchema>;

export const FileListQuerySchema = PaginationQuerySchema.extend({
	externalId: z.string().min(1).optional().describe("Only files with this externalId"),
	contentTypePrefix: z.string().min(1).optional().describe("Only files whose content type starts with this prefix")
}).meta({ id: "FileListQuery" });
export type FileListQuery = z.infer<typeof FileListQuerySchema>;

export const FileListResponseSchema = z
	.object({
		files: z.array(FileViewSchema).describe("A page of files, newest first"),
		nextCursor: z.string().optional().describe("Pass as cursor to get the next page")
	})
	.meta({ id: "FileList" });
export type FileListResponse = z.infer<typeof FileListResponseSchema>;

const FileFromUrlFieldsSchema = z.object({
	url: CallbackUrlSchema.describe("Public http or https URL to fetch the file from"),
	filename: filenameField.optional().describe("Filename to store the file under"),
	externalId: z.string().min(1).max(255).optional().describe("Caller-side identifier for the file")
});

export const FileFromUrlRequestSchema = FileFromUrlFieldsSchema.and(DestinationInputSchema).meta({
	id: "FileFromUrlRequest",
	example: { url: "https://example.test/assets/logo.png", externalId: "logo-42" }
});
export type FileFromUrlRequest = z.infer<typeof FileFromUrlRequestSchema>;

export const FileDeletedResponseSchema = z
	.object({ fileId: z.string().describe("Id of the deleted file") })
	.meta({ id: "FileDeletedResponse" });
export type FileDeletedResponse = z.infer<typeof FileDeletedResponseSchema>;
