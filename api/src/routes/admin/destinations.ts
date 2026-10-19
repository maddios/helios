import { DestinationTestRequestSchema, DestinationTestResponseSchema } from "@helios/contracts";
import { getAccount } from "@helios/core";
import { endpoint } from "../../http/endpoint";
import { testDestination } from "../../http/testDestination";
import { IdParams } from "../params";

export const adminDestinationRoutes = [
	endpoint({
		method: "post",
		path: "/admin/accounts/{id}/destinations/test",
		summary: "Send a helios.test event to an account destination or to a supplied one",
		auth: "admin",
		tags: ["Destinations"],
		input: { params: IdParams, body: DestinationTestRequestSchema },
		responses: {
			200: { description: "Test result; ok is false when delivery failed", schema: DestinationTestResponseSchema }
		},
		errors: [404],
		handle: async ({ input }) => testDestination(await getAccount(input.params.id), input.body.destination)
	})
];
