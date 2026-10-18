import {
	ActiveStillPatchSchema,
	ActiveStillResponseSchema,
	AssetDeletedResponseSchema,
	AssetListQuerySchema,
	AssetListResponseSchema,
	AssetScenesResponseSchema,
	AssetTranscriptsResponseSchema,
	AssetViewSchema
} from "@helios/contracts";
import {
	findLiveAsset,
	latestSceneAnalysis,
	listAssets,
	listTranscripts,
	requestPurge,
	setActiveStill
} from "@helios/core";
import { endpoint } from "../http/endpoint";
import { reply } from "../http/reply";
import { toAssetViews } from "../views/asset";
import { toSceneAnalysisView, toTranscriptView } from "../views/analysis";
import { IdParams } from "./params";

export const assetRoutes = [
	endpoint({
		method: "get",
		path: "/assets",
		summary: "List assets, optionally by externalId",
		auth: "account",
		input: { query: AssetListQuerySchema },
		responses: { 200: { description: "A page of assets", schema: AssetListResponseSchema } },
		handle: async ({ account, input }) => {
			const page = await listAssets(account._id, input.query);
			return reply.ok({
				assets: await toAssetViews(account._id, page.assets),
				...(page.nextCursor !== undefined && { nextCursor: page.nextCursor })
			});
		}
	}),
	endpoint({
		method: "get",
		path: "/assets/{id}",
		summary: "Get an asset with its outputs and CDN urls",
		auth: "account",
		input: { params: IdParams },
		responses: { 200: { description: "The asset", schema: AssetViewSchema } },
		errors: [404],
		handle: async ({ account, input }) => {
			const [view] = await toAssetViews(account._id, [await findLiveAsset(account._id, input.params.id)]);
			return reply.ok(view);
		}
	}),
	endpoint({
		method: "patch",
		path: "/assets/{id}/active-still",
		summary: "Select the active still of an asset",
		auth: "account",
		input: { params: IdParams, body: ActiveStillPatchSchema },
		responses: { 200: { description: "Selected still", schema: ActiveStillResponseSchema } },
		errors: [404, 409],
		handle: async ({ account, input }) =>
			reply.ok({ activeStill: await setActiveStill(account._id, input.params.id, input.body.index) })
	}),
	endpoint({
		method: "delete",
		path: "/assets/{id}",
		summary: "Delete an asset and purge its outputs (asynchronous)",
		auth: "account",
		input: { params: IdParams },
		responses: { 202: { description: "Purge accepted", schema: AssetDeletedResponseSchema } },
		errors: [404],
		handle: async ({ account, input }) => {
			await requestPurge(account._id, input.params.id);
			return reply.accepted({ assetId: input.params.id });
		}
	}),
	endpoint({
		method: "get",
		path: "/assets/{id}/transcripts",
		summary: "List transcripts of an asset",
		auth: "account",
		input: { params: IdParams },
		responses: { 200: { description: "Transcripts", schema: AssetTranscriptsResponseSchema } },
		errors: [404],
		handle: async ({ account, input }) => {
			await findLiveAsset(account._id, input.params.id);
			const transcripts = await listTranscripts(account._id, input.params.id);
			return reply.ok({ transcripts: transcripts.map(toTranscriptView) });
		}
	}),
	endpoint({
		method: "get",
		path: "/assets/{id}/scenes",
		summary: "Get the latest scene analysis of an asset",
		auth: "account",
		input: { params: IdParams },
		responses: { 200: { description: "Scene analysis", schema: AssetScenesResponseSchema } },
		errors: [404],
		handle: async ({ account, input }) => {
			await findLiveAsset(account._id, input.params.id);
			return reply.ok(toSceneAnalysisView(await latestSceneAnalysis(account._id, input.params.id)));
		}
	})
];
