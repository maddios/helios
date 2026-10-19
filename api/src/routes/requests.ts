import { CallbackDeliveryListResponseSchema, RedeliverResponseSchema, RequestViewSchema } from "@helios/contracts";
import { cancelRequest, listDeliveries, loadAccountRequest, redeliver, toRequestView } from "@helios/core";
import { apiConfig } from "../config";
import { endpoint } from "../http/endpoint";
import { reply } from "../http/reply";
import { toCallbackView } from "../views/callback";
import { IdParams } from "./params";

export const requestRoutes = [
	endpoint({
		method: "get",
		path: "/requests/{id}",
		summary: "Get a request with its items and progress",
		auth: "account",
		input: { params: IdParams },
		responses: { 200: { description: "The request", schema: RequestViewSchema } },
		errors: [404],
		handle: async ({ account, input }) =>
			reply.ok(await toRequestView(await loadAccountRequest(account._id, input.params.id)))
	}),
	endpoint({
		method: "delete",
		path: "/requests/{id}",
		summary: "Cancel a request",
		auth: "account",
		input: { params: IdParams },
		responses: { 200: { description: "Cancelled request", schema: RequestViewSchema } },
		errors: [404, 409],
		handle: async ({ account, input }) =>
			reply.ok(await toRequestView(await cancelRequest(account._id, input.params.id)))
	}),
	endpoint({
		method: "get",
		path: "/requests/{id}/callbacks",
		summary: "List callback deliveries of a request",
		auth: "account",
		tags: ["Webhooks"],
		input: { params: IdParams },
		responses: { 200: { description: "Callback deliveries", schema: CallbackDeliveryListResponseSchema } },
		errors: [404],
		handle: async ({ account, input }) => {
			await loadAccountRequest(account._id, input.params.id);
			const deliveries = await listDeliveries(account._id, input.params.id);
			return reply.ok({ deliveries: deliveries.map(toCallbackView) });
		}
	}),
	endpoint({
		method: "post",
		path: "/requests/{id}/callbacks/redeliver",
		summary: "Redeliver the final callback of a finished request",
		auth: "account",
		tags: ["Webhooks"],
		input: { params: IdParams },
		responses: { 202: { description: "Redelivery queued", schema: RedeliverResponseSchema } },
		errors: [404, 409, 429],
		handle: async ({ account, input }) => {
			await redeliver(account._id, input.params.id, apiConfig().REDELIVER_COOLDOWN_SEC);
			return reply.accepted({ requestId: input.params.id });
		}
	})
];
