import { AdminUsageResponseSchema, UsageQuerySchema } from "@helios/contracts";
import { getAdminUsage } from "@helios/core";
import { endpoint } from "../../http/endpoint";
import { reply } from "../../http/reply";

export const adminUsageRoutes = [
	endpoint({
		method: "get",
		path: "/admin/usage",
		summary: "Resource units used by every account over a date range",
		auth: "admin",
		input: { query: UsageQuerySchema },
		responses: { 200: { description: "Usage by account", schema: AdminUsageResponseSchema } },
		handle: async ({ input }) => reply.ok(await getAdminUsage(input.query.from, input.query.to))
	})
];
