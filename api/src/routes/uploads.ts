import { z } from "zod";
import {
	MultipartAbortQuerySchema,
	MultipartCompleteRequestSchema,
	MultipartCompleteResponseSchema,
	MultipartCreateRequestSchema,
	MultipartCreateResponseSchema,
	PresignedUploadRequestSchema,
	PresignedUploadResponseSchema
} from "@helios/contracts";
import {
	abortMultipartUpload,
	completeMultipartUpload,
	createEncode,
	createMultipartUpload,
	createPresignedUpload
} from "@helios/core";
import { endpoint } from "../http/endpoint";
import { requestReply } from "../http/requestReply";
import { reply } from "../http/reply";

const UploadIdParams = z.object({ uploadId: z.string().min(1).describe("Multipart upload id") });

export const uploadRoutes = [
	endpoint({
		method: "post",
		path: "/uploads/presigned",
		summary: "Get a presigned URL for a single-PUT upload",
		auth: "account",
		input: { body: PresignedUploadRequestSchema },
		responses: { 201: { description: "Presigned upload", schema: PresignedUploadResponseSchema } },
		handle: async ({ account, input }) => reply.created(await createPresignedUpload(account.slug, input.body))
	}),
	endpoint({
		method: "post",
		path: "/uploads/multipart",
		summary: "Start a multipart upload and get presigned part URLs",
		auth: "account",
		input: { body: MultipartCreateRequestSchema },
		responses: { 201: { description: "Multipart upload", schema: MultipartCreateResponseSchema } },
		handle: async ({ account, input }) => reply.created(await createMultipartUpload(account.slug, input.body))
	}),
	endpoint({
		method: "post",
		path: "/uploads/multipart/{uploadId}/complete",
		summary: "Complete a multipart upload, optionally encoding it",
		auth: "account",
		input: { params: UploadIdParams, body: MultipartCompleteRequestSchema },
		responses: {
			200: { description: "Completed upload, or repeated encode request", schema: MultipartCompleteResponseSchema },
			201: { description: "Sync encode request created", schema: MultipartCompleteResponseSchema },
			202: { description: "Async encode request accepted", schema: MultipartCompleteResponseSchema }
		},
		errors: [403, 404, 409, 422],
		handle: async ({ account, input }) => {
			const { uploadId } = input.params;
			const uploadKey = await completeMultipartUpload(account.slug, {
				uploadId,
				uploadKey: input.body.uploadKey,
				parts: input.body.parts
			});
			const { encode } = input.body;
			if (encode === undefined) {
				return reply.ok({ uploadKey });
			}
			const result = await createEncode(account, { ...encode, source: { uploadKey } });
			return requestReply(result, encode.analyze, (request) => ({ uploadKey, request }));
		}
	}),
	endpoint({
		method: "delete",
		path: "/uploads/multipart/{uploadId}",
		summary: "Abort a multipart upload",
		auth: "account",
		input: { params: UploadIdParams, query: MultipartAbortQuerySchema },
		responses: { 204: { description: "Upload aborted" } },
		handle: async ({ account, input }) => {
			await abortMultipartUpload(account.slug, { uploadId: input.params.uploadId, uploadKey: input.query.uploadKey });
			return reply.noContent();
		}
	})
];
