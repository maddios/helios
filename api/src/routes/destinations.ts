import {
	AccountDestinationRequestSchema,
	AccountDestinationResponseSchema,
	DestinationTestRequestSchema,
	DestinationTestResponseSchema,
	EventBridgePolicyQuerySchema,
	EventBridgePolicyResponseSchema
} from "@helios/contracts";
import { eventBridgePolicy, updateAccount } from "@helios/core";
import { endpoint } from "../http/endpoint";
import { reply } from "../http/reply";
import { testDestination } from "../http/testDestination";

export const destinationRoutes = [
	endpoint({
		method: "get",
		path: "/account/destination",
		summary: "Get the account default delivery destination",
		auth: "account",
		tags: ["Destinations"],
		responses: { 200: { description: "Default destination", schema: AccountDestinationResponseSchema } },
		handle: async ({ account }) => reply.ok({ destination: account.destination ?? null })
	}),
	endpoint({
		method: "put",
		path: "/account/destination",
		summary: "Set or clear the account default delivery destination",
		auth: "account",
		tags: ["Destinations"],
		input: { body: AccountDestinationRequestSchema },
		responses: { 200: { description: "Updated default destination", schema: AccountDestinationResponseSchema } },
		errors: [422],
		handle: async ({ account, input }) => {
			const updated = await updateAccount(account._id, { destination: input.body.destination });
			return reply.ok({ destination: updated.destination ?? null });
		}
	}),
	endpoint({
		method: "post",
		path: "/destinations/test",
		summary: "Send a helios.test event to the account destination or to a supplied one",
		auth: "account",
		tags: ["Destinations"],
		input: { body: DestinationTestRequestSchema },
		responses: {
			200: { description: "Test result; ok is false when delivery failed", schema: DestinationTestResponseSchema }
		},
		errors: [422, 429],
		handle: async ({ account, input }) => testDestination(account, input.body.destination)
	}),
	endpoint({
		method: "get",
		path: "/destinations/eventbridge/policy",
		summary: "Get the resource policy and AWS CLI command that let Helios put events on a bus",
		auth: "account",
		tags: ["Destinations"],
		input: { query: EventBridgePolicyQuerySchema },
		responses: { 200: { description: "Policy and command", schema: EventBridgePolicyResponseSchema } },
		errors: [422],
		handle: async ({ account, input }) => reply.ok(eventBridgePolicy(input.query.eventBusArn, account._id))
	})
];
