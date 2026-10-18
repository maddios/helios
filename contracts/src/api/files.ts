import { z } from "zod";

export const FileUploadRequestSchema = z
	.object({
		filename: z.string().min(1).max(255).describe("Original filename of the file"),
		contentType: z.string().optional().describe("MIME type of the file")
	})
	.meta({ id: "FileUploadRequest" });
export type FileUploadRequest = z.infer<typeof FileUploadRequestSchema>;

export const FileUploadResponseSchema = z
	.object({
		fileKey: z.string().describe("Storage key of the file"),
		uploadUrl: z.url().describe("Presigned URL to PUT the file to"),
		url: z.url().describe("CDN URL the file is served from once uploaded"),
		expiresAt: z.iso.datetime().describe("When the presigned upload URL expires")
	})
	.meta({ id: "FileUploadResponse" });
export type FileUploadResponse = z.infer<typeof FileUploadResponseSchema>;
