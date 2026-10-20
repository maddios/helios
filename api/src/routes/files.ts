import {
	FileDeletedResponseSchema,
	FileFromUrlRequestSchema,
	FileListQuerySchema,
	FileListResponseSchema,
	FileViewSchema
} from "@helios/contracts";
import { createFileFromUrl, deleteFile, listFiles, loadFile, toFileView } from "@helios/core";
import { endpoint } from "../http/endpoint";
import { reply } from "../http/reply";
import { IdParams } from "./params";

export const fileRoutes = [
	endpoint({
		method: "get",
		path: "/files",
		summary: "List files, newest first",
		auth: "account",
		input: { query: FileListQuerySchema },
		responses: { 200: { description: "A page of files", schema: FileListResponseSchema } },
		handle: async ({ account, input }) => {
			const page = await listFiles(account._id, input.query);
			return reply.ok({
				files: page.docs.map(toFileView),
				...(page.nextCursor !== undefined && { nextCursor: page.nextCursor })
			});
		}
	}),
	endpoint({
		method: "get",
		path: "/files/{id}",
		summary: "Get a file with its CDN url",
		auth: "account",
		input: { params: IdParams },
		responses: { 200: { description: "The file", schema: FileViewSchema } },
		errors: [404],
		handle: async ({ account, input }) => reply.ok(toFileView(await loadFile(account._id, input.params.id)))
	}),
	endpoint({
		method: "delete",
		path: "/files/{id}",
		summary: "Delete a file: its object, cached image variants and CDN copies",
		auth: "account",
		input: { params: IdParams },
		responses: { 200: { description: "File deleted", schema: FileDeletedResponseSchema } },
		errors: [404, 409],
		handle: async ({ account, input }) => {
			await deleteFile(account._id, input.params.id);
			return reply.ok({ fileId: input.params.id });
		}
	}),
	endpoint({
		method: "post",
		path: "/files/from-url",
		summary: "Store a file fetched from a public URL (asynchronous)",
		auth: "account",
		input: { body: FileFromUrlRequestSchema },
		responses: { 202: { description: "File accepted; it becomes STORED or FAILED", schema: FileViewSchema } },
		errors: [400],
		handle: async ({ account, input }) => reply.accepted(toFileView(await createFileFromUrl(account, input.body)))
	})
];
