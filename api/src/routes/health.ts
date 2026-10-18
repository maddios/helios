import { HealthResponseSchema, ReadyResponseSchema } from "@helios/contracts";
import { pingDatabase } from "@helios/core";
import { endpoint } from "../http/endpoint";
import { reply } from "../http/reply";

export const healthRoutes = [
	endpoint({
		method: "get",
		path: "/health",
		summary: "Process liveness; does not touch the database",
		auth: "none",
		responses: { 200: { description: "Process is alive", schema: HealthResponseSchema } },
		handle: async () => reply.ok({ status: "ok" })
	}),
	endpoint({
		method: "get",
		path: "/ready",
		summary: "Readiness: pings the database",
		auth: "none",
		responses: { 200: { description: "Database answers a ping", schema: ReadyResponseSchema } },
		handle: async () => {
			await pingDatabase();
			return reply.ok({ status: "ready" });
		}
	})
];
