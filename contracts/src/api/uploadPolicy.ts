import { z } from "zod";

const MEDIA_TOKEN = "[a-z0-9][a-z0-9.+-]*";
const CONTENT_TYPE = new RegExp(`^${MEDIA_TOKEN}/${MEDIA_TOKEN}$`);
const CONTENT_TYPE_PATTERN = new RegExp(`^(\\*/\\*|${MEDIA_TOKEN}/(\\*|${MEDIA_TOKEN}))$`);

export const ContentTypeSchema = z
	.string()
	.trim()
	.toLowerCase()
	.regex(CONTENT_TYPE, "must be a type/subtype such as video/mp4, without parameters")
	.describe("MIME type of the file, such as video/mp4");
export type ContentType = z.infer<typeof ContentTypeSchema>;

export const ContentTypePatternSchema = z
	.string()
	.trim()
	.toLowerCase()
	.regex(CONTENT_TYPE_PATTERN, "must be an exact type/subtype, a type/* wildcard, or */*")
	.describe("Exact MIME type such as image/png, a wildcard such as image/*, or */*");

export const UploadPolicySchema = z
	.object({
		allowedContentTypes: z
			.array(ContentTypePatternSchema)
			.min(1)
			.describe("MIME types uploads may use: exact types, type/* wildcards, or */*"),
		maxBytes: z.int().positive().describe("Largest file in bytes the account may upload")
	})
	.meta({
		id: "UploadPolicy",
		example: { allowedContentTypes: ["image/*", "video/mp4"], maxBytes: 5368709120 }
	});
export type UploadPolicy = z.infer<typeof UploadPolicySchema>;
