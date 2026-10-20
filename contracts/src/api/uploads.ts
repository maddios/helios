import { z } from "zod";
import { EncodeOptionsSchema } from "./encode";
import { FileViewSchema } from "./files";
import { RequestViewSchema } from "./requests";
import { ContentTypeSchema, UploadPolicySchema } from "./uploadPolicy";
import { filenameField } from "./filename";

const MAX_PART_NUMBER = 10000;
const MAX_PARTS_PER_SIGN = 1000;

export const CreateUploadRequestSchema = z
	.object({
		filename: filenameField.describe("Original filename of the file"),
		sizeBytes: z.int().positive().describe("Size of the file in bytes; must not exceed the upload size limit"),
		contentType: ContentTypeSchema,
		externalId: z.string().min(1).max(255).optional().describe("Caller-side identifier for the file"),
		policy: UploadPolicySchema.optional().describe(
			"Narrower policy for this upload; it may only restrict the account policy, never widen it"
		)
	})
	.meta({
		id: "CreateUploadRequest",
		example: { filename: "clip.mp4", sizeBytes: 52428800, contentType: "video/mp4", externalId: "clip-7" }
	});
export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;

const UploadBaseSchema = z.object({
	fileId: z.string().describe("File id; every later call is keyed by it"),
	key: z.string().describe("Storage key the file will be stored at"),
	expiresAt: z.iso.datetime().describe("When the presigned URLs expire")
});

const SingleUploadSchema = UploadBaseSchema.extend({
	mode: z.literal("single").describe("Upload with one presigned PUT"),
	url: z.url().describe("Presigned URL to PUT the file to"),
	headers: z
		.record(z.string(), z.string())
		.describe("Headers the PUT must send exactly: Content-Type and Content-Disposition, both signed")
}).meta({ id: "SingleUpload" });

const MultipartUploadSchema = UploadBaseSchema.extend({
	mode: z.literal("multipart").describe("Upload in parts, each with its own presigned PUT"),
	uploadId: z.string().describe("S3 multipart upload id"),
	partSizeBytes: z.int().describe("Size of each part except possibly the last, in bytes"),
	parts: z
		.array(
			z.object({
				partNumber: z.int().describe("1-based part number"),
				url: z.url().describe("Presigned URL to PUT this part to")
			})
		)
		.describe("Presigned part upload URLs")
}).meta({ id: "MultipartUpload" });

export const CreateUploadResponseSchema = z
	.discriminatedUnion("mode", [SingleUploadSchema, MultipartUploadSchema])
	.meta({ id: "CreateUploadResponse" });
export type CreateUploadResponse = z.infer<typeof CreateUploadResponseSchema>;

export const UploadPartsSchema = z
	.array(
		z.object({
			partNumber: z.int().positive().describe("1-based part number"),
			etag: z.string().min(1).describe("ETag returned when the part was uploaded")
		})
	)
	.min(1)
	.max(MAX_PART_NUMBER)
	.describe("Uploaded parts; required for a multipart upload, forbidden for a single PUT");

export const CompleteUploadRequestSchema = z
	.object({ parts: UploadPartsSchema.optional() })
	.and(
		z.union([
			z.object({ store: z.literal(true).describe("Keep the file as stored, without encoding") }).strict(),
			z.object({ encode: EncodeOptionsSchema.describe("Encode the file once it is stored") }).strict()
		])
	)
	.meta({ id: "CompleteUploadRequest", example: { store: true } });
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequestSchema>;

export const CompleteUploadResponseSchema = z
	.object({
		file: FileViewSchema.describe("The stored file"),
		request: RequestViewSchema.optional().describe("Encode request created when encode options were given")
	})
	.meta({ id: "CompleteUploadResponse" });
export type CompleteUploadResponse = z.infer<typeof CompleteUploadResponseSchema>;

export const SignUploadPartsRequestSchema = z
	.object({
		partNumbers: z
			.array(z.int().min(1).max(MAX_PART_NUMBER).describe("1-based part number"))
			.min(1)
			.max(MAX_PARTS_PER_SIGN)
			.refine((numbers) => new Set(numbers).size === numbers.length, "Part numbers must be unique")
			.describe("Parts to sign, at most 1000 per call")
	})
	.meta({ id: "SignUploadPartsRequest", example: { partNumbers: [3] } });
export type SignUploadPartsRequest = z.infer<typeof SignUploadPartsRequestSchema>;

export const SignUploadPartsResponseSchema = z
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
	.meta({ id: "SignUploadPartsResponse" });
export type SignUploadPartsResponse = z.infer<typeof SignUploadPartsResponseSchema>;

export const UploadPartsListResponseSchema = z
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
		id: "UploadPartsListResponse",
		example: {
			parts: [
				{ partNumber: 1, etag: '"5d41402abc4b2a76b9719d911017c592"', sizeBytes: 5242880 },
				{ partNumber: 2, etag: '"7d865e959b2466918c9863afca942d0f"', sizeBytes: 5242880 }
			]
		}
	});
export type UploadPartsListResponse = z.infer<typeof UploadPartsListResponseSchema>;
export type UploadParts = z.infer<typeof UploadPartsSchema>;
