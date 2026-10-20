import { z } from "zod";
import {
	CompleteUploadRequestSchema,
	CompleteUploadResponseSchema,
	CreateUploadRequestSchema,
	CreateUploadResponseSchema,
	SignUploadPartsRequestSchema,
	SignUploadPartsResponseSchema,
	UploadPartsListResponseSchema
} from "@helios/contracts";
import {
	abortUpload,
	completeUpload,
	createUpload,
	encodeUploadedFile,
	listUploadParts,
	signUploadParts,
	toFileView
} from "@helios/core";
import { endpoint } from "../http/endpoint";
import { reply } from "../http/reply";
import { requestReply } from "../http/requestReply";

const FileIdParams = z.object({ fileId: z.string().min(1).describe("File id returned by create") });

export const uploadRoutes = [
	endpoint({
		method: "post",
		path: "/uploads",
		summary: "Start an upload; small files get one presigned PUT, large files a multipart upload",
		auth: "account",
		input: { body: CreateUploadRequestSchema },
		responses: { 201: { description: "Upload started", schema: CreateUploadResponseSchema } },
		errors: [400, 422],
		handle: async ({ account, input }) => reply.created(await createUpload(account, input.body))
	}),
	endpoint({
		method: "post",
		path: "/uploads/{fileId}/complete",
		summary: "Complete an upload, then store the file or store it and encode it",
		auth: "account",
		input: { params: FileIdParams, body: CompleteUploadRequestSchema },
		responses: {
			200: { description: "Stored file, or the file of an earlier completion", schema: CompleteUploadResponseSchema },
			201: { description: "Sync encode request created", schema: CompleteUploadResponseSchema },
			202: { description: "Async encode request accepted", schema: CompleteUploadResponseSchema }
		},
		errors: [400, 404, 409, 422],
		handle: async ({ account, input }) => {
			const file = await completeUpload(account, input.params.fileId, input.body.parts);
			if (!("encode" in input.body)) {
				return reply.ok({ file: toFileView(file) });
			}
			const { encode } = input.body;
			const result = await encodeUploadedFile(account, file, encode);
			return requestReply(result, encode.analyze, (request) => ({ file: toFileView(file), request }));
		}
	}),
	endpoint({
		method: "post",
		path: "/uploads/{fileId}/parts",
		summary: "Get fresh presigned URLs for some parts of a multipart upload",
		auth: "account",
		input: { params: FileIdParams, body: SignUploadPartsRequestSchema },
		responses: { 200: { description: "Presigned part URLs", schema: SignUploadPartsResponseSchema } },
		errors: [400, 404, 409],
		handle: async ({ account, input }) =>
			reply.ok(await signUploadParts(account, input.params.fileId, input.body.partNumbers))
	}),
	endpoint({
		method: "get",
		path: "/uploads/{fileId}/parts",
		summary: "List the parts already uploaded to a multipart upload, for resuming",
		auth: "account",
		input: { params: FileIdParams },
		responses: { 200: { description: "Uploaded parts", schema: UploadPartsListResponseSchema } },
		errors: [400, 404, 409],
		handle: async ({ account, input }) => reply.ok(await listUploadParts(account._id, input.params.fileId))
	}),
	endpoint({
		method: "delete",
		path: "/uploads/{fileId}",
		summary: "Abort a pending upload and discard what it stored",
		auth: "account",
		input: { params: FileIdParams },
		responses: { 204: { description: "Upload aborted" } },
		errors: [404, 409],
		handle: async ({ account, input }) => {
			await abortUpload(account._id, input.params.fileId);
			return reply.noContent();
		}
	})
];
