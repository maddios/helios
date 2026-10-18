import { AssetPostProcessRequestSchema, ReencodeRequestSchema, RequestViewSchema } from "@helios/contracts";
import { postProcess, reencode } from "@helios/core";
import { endpoint } from "../http/endpoint";
import { requestReply } from "../http/requestReply";
import { IdParams } from "./params";

const acceptedResponse = {
	202: { description: "Request accepted", schema: RequestViewSchema },
	200: { description: "Repeated request", schema: RequestViewSchema }
};

export const assetJobRoutes = [
	endpoint({
		method: "post",
		path: "/assets/{id}/re-encode",
		summary: "Re-encode an asset, bumping its version",
		auth: "account",
		input: { params: IdParams, body: ReencodeRequestSchema },
		responses: acceptedResponse,
		errors: [404, 409, 422],
		handle: async ({ account, input }) => requestReply(await reencode(account, input.params.id, input.body), "async")
	}),
	endpoint({
		method: "post",
		path: "/assets/{id}/post-process",
		summary: "Run post-processing on an asset",
		auth: "account",
		input: { params: IdParams, body: AssetPostProcessRequestSchema },
		responses: acceptedResponse,
		errors: [404, 409, 422],
		handle: async ({ account, input }) => requestReply(await postProcess(account, input.params.id, input.body), "async")
	})
];
