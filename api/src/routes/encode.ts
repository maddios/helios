import { z } from "zod";
import { DryRunResponseSchema, EncodeQuerySchema, EncodeRequestSchema, RequestViewSchema } from "@helios/contracts";
import { createEncode, dryRunEncode } from "@helios/core";
import { endpoint } from "../http/endpoint";
import { reply } from "../http/reply";
import { requestReply } from "../http/requestReply";

const EncodeResponseSchema = z.union([RequestViewSchema, DryRunResponseSchema]);

export const encodeRoutes = [
	endpoint({
		method: "post",
		path: "/encode",
		summary: "Create an encode request, or plan one with dryRun=true",
		auth: "account",
		input: { query: EncodeQuerySchema, body: EncodeRequestSchema },
		responses: {
			200: { description: "Repeated request, or dry-run plan", schema: EncodeResponseSchema },
			201: { description: "Sync request created", schema: RequestViewSchema },
			202: { description: "Async request accepted", schema: RequestViewSchema }
		},
		errors: [404, 409, 422],
		handle: async ({ account, input }) => {
			if (input.query.dryRun) {
				return reply.ok(await dryRunEncode(account, input.body));
			}
			return requestReply(await createEncode(account, input.body), input.body.analyze);
		}
	})
];
