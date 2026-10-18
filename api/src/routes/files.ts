import { FileUploadRequestSchema, FileUploadResponseSchema } from "@helios/contracts";
import { createRawFileUpload } from "@helios/core";
import { endpoint } from "../http/endpoint";
import { reply } from "../http/reply";

export const fileRoutes = [
	endpoint({
		method: "post",
		path: "/files",
		summary: "Get a presigned URL for a raw (non-media) file",
		auth: "account",
		input: { body: FileUploadRequestSchema },
		responses: { 201: { description: "Presigned file upload", schema: FileUploadResponseSchema } },
		handle: async ({ account, input }) => reply.created(await createRawFileUpload(account.slug, input.body))
	})
];
