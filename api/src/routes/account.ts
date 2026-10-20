import { UploadPolicySchema } from "@helios/contracts";
import { effectiveUploadPolicy, updateAccount } from "@helios/core";
import { endpoint } from "../http/endpoint";
import { reply } from "../http/reply";

export const accountRoutes = [
	endpoint({
		method: "get",
		path: "/account/upload-policy",
		summary: "Get the upload policy in effect for the account",
		auth: "account",
		responses: { 200: { description: "Upload policy", schema: UploadPolicySchema } },
		handle: async ({ account }) => reply.ok(effectiveUploadPolicy(account))
	}),
	endpoint({
		method: "patch",
		path: "/account/upload-policy",
		summary: "Set the upload policy; uploads may only be narrowed per request",
		auth: "account",
		input: { body: UploadPolicySchema },
		responses: { 200: { description: "Upload policy in effect", schema: UploadPolicySchema } },
		errors: [400],
		handle: async ({ account, input }) =>
			reply.ok(effectiveUploadPolicy(await updateAccount(account._id, { uploadPolicy: input.body })))
	})
];
