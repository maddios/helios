import { UsageQuerySchema, UsageResponseSchema } from "@helios/contracts";
import { getUsage } from "@helios/core";
import { endpoint } from "../http/endpoint";
import { reply } from "../http/reply";

export const usageRoutes = [
	endpoint({
		method: "get",
		path: "/usage",
		summary: "Resource units used by the account over a date range",
		auth: "account",
		input: { query: UsageQuerySchema },
		responses: { 200: { description: "Usage", schema: UsageResponseSchema } },
		handle: async ({ account, input }) => reply.ok(await getUsage(account._id, input.query.from, input.query.to))
	})
];
