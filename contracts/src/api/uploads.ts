import { z } from "zod";
import { EncodeOptionsSchema } from "./encode";
import { RequestViewSchema } from "./requests";

export const PresignedUploadRequestSchema = z
	.object({
		filename: z.string().min(1).max(255).describe("Original filename of the upload"),
		sizeBytes: z.int().positive().describe("Size of the file in bytes; must not exceed the upload size limit"),
		contentType: z.string().optional().describe("MIME type of the upload")
	})
	.meta({ id: "PresignedUploadRequest" });
export type PresignedUploadRequest = z.infer<typeof PresignedUploadRequestSchema>;

export const PresignedUploadResponseSchema = z
	.object({
		uploadKey: z.string().describe("Storage key of the upload; pass it to encode"),
		url: z.url().describe("Presigned URL to PUT the file to"),
		expiresAt: z.iso.datetime().describe("When the presigned URL expires")
	})
	.meta({ id: "PresignedUploadResponse" });
export type PresignedUploadResponse = z.infer<typeof PresignedUploadResponseSchema>;

export const MultipartCreateRequestSchema = z
	.object({
		filename: z.string().min(1).max(255).describe("Original filename of the upload"),
		sizeBytes: z.int().positive().describe("Total size of the file in bytes"),
		contentType: z.string().optional().describe("MIME type of the upload")
	})
	.meta({ id: "MultipartCreateRequest" });
export type MultipartCreateRequest = z.infer<typeof MultipartCreateRequestSchema>;

export const MultipartCreateResponseSchema = z
	.object({
		uploadId: z.string().describe("Multipart upload id"),
		uploadKey: z.string().describe("Storage key of the upload; pass it to complete"),
		partSizeBytes: z.int().describe("Size of each part except possibly the last, in bytes"),
		parts: z
			.array(
				z.object({
					partNumber: z.int().describe("1-based part number"),
					url: z.url().describe("Presigned URL to PUT this part to")
				})
			)
			.describe("Presigned part upload URLs")
	})
	.meta({ id: "MultipartCreateResponse" });
export type MultipartCreateResponse = z.infer<typeof MultipartCreateResponseSchema>;

export const MultipartCompleteRequestSchema = z
	.object({
		uploadKey: z.string().min(1).describe("Storage key returned by create"),
		parts: z
			.array(
				z.object({
					partNumber: z.int().positive().describe("1-based part number"),
					etag: z.string().min(1).describe("ETag returned when the part was uploaded")
				})
			)
			.min(1)
			.describe("Uploaded parts"),
		encode: EncodeOptionsSchema.optional().describe("Encode the upload once it completes")
	})
	.meta({ id: "MultipartCompleteRequest" });
export type MultipartCompleteRequest = z.infer<typeof MultipartCompleteRequestSchema>;

export const MultipartCompleteResponseSchema = z
	.object({
		uploadKey: z.string().describe("Storage key of the completed upload"),
		request: RequestViewSchema.optional().describe("Encode request created when encode options were given")
	})
	.meta({ id: "MultipartCompleteResponse" });
export type MultipartCompleteResponse = z.infer<typeof MultipartCompleteResponseSchema>;

export const MultipartAbortQuerySchema = z
	.object({
		uploadKey: z.string().min(1).describe("Storage key of the upload to abort")
	})
	.meta({ id: "MultipartAbortQuery" });
export type MultipartAbortQuery = z.infer<typeof MultipartAbortQuerySchema>;
