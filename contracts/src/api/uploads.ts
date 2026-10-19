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
			.max(10000)
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

const MAX_PART_NUMBER = 10000;
const MAX_PARTS_PER_SIGN = 1000;

export const MultipartSignPartsRequestSchema = z
	.object({
		uploadKey: z.string().min(1).describe("Storage key returned by create"),
		partNumbers: z
			.array(z.int().min(1).max(MAX_PART_NUMBER).describe("1-based part number"))
			.min(1)
			.max(MAX_PARTS_PER_SIGN)
			.refine((numbers) => new Set(numbers).size === numbers.length, "Part numbers must be unique")
			.describe("Parts to sign, at most 1000 per call")
	})
	.meta({
		id: "MultipartSignPartsRequest",
		example: { uploadKey: "acme/uploads/0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601/clip.mp4", partNumbers: [3] }
	});
export type MultipartSignPartsRequest = z.infer<typeof MultipartSignPartsRequestSchema>;

export const MultipartSignPartsResponseSchema = z
	.object({
		parts: z
			.array(
				z.object({
					partNumber: z.int().describe("1-based part number"),
					url: z.url().describe("Fresh presigned URL to PUT this part to")
				})
			)
			.describe("Presigned part upload URLs, in request order"),
		expiresAt: z.iso.datetime().describe("When the presigned URLs expire")
	})
	.meta({
		id: "MultipartSignPartsResponse",
		example: {
			parts: [
				{
					partNumber: 3,
					url: "https://media.example.test/acme/uploads/0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601/clip.mp4?partNumber=3"
				}
			],
			expiresAt: "2026-10-20T06:00:00.000Z"
		}
	});
export type MultipartSignPartsResponse = z.infer<typeof MultipartSignPartsResponseSchema>;

export const MultipartListPartsQuerySchema = z
	.object({
		uploadKey: z
			.string()
			.min(1)
			.describe("Storage key returned by create")
			.meta({ example: "acme/uploads/0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601/clip.mp4" })
	})
	.meta({ id: "MultipartListPartsQuery" });
export type MultipartListPartsQuery = z.infer<typeof MultipartListPartsQuerySchema>;

export const MultipartListPartsResponseSchema = z
	.object({
		parts: z
			.array(
				z.object({
					partNumber: z.int().describe("1-based part number"),
					etag: z.string().min(1).describe("ETag of the uploaded part, as storage returned it"),
					sizeBytes: z.int().nonnegative().describe("Size of the uploaded part in bytes")
				})
			)
			.describe("Parts stored so far, sorted by part number")
	})
	.meta({
		id: "MultipartListPartsResponse",
		example: {
			parts: [
				{ partNumber: 1, etag: '"5d41402abc4b2a76b9719d911017c592"', sizeBytes: 5242880 },
				{ partNumber: 2, etag: '"7d865e959b2466918c9863afca942d0f"', sizeBytes: 5242880 }
			]
		}
	});
export type MultipartListPartsResponse = z.infer<typeof MultipartListPartsResponseSchema>;
