import {
	CreatePresetRequestSchema,
	ExpectedVersionQuerySchema,
	PresetListResponseSchema,
	PresetViewSchema,
	UpdatePresetRequestSchema
} from "@helios/contracts";
import { createPreset, deletePreset, findOwned, listSystemPresets, updatePreset } from "@helios/core";
import { endpoint } from "../../http/endpoint";
import { reply } from "../../http/reply";
import { toPresetView } from "../../views/preset";
import { NameParams } from "../params";

export const adminPresetRoutes = [
	endpoint({
		method: "get",
		path: "/admin/presets",
		summary: "List system presets",
		auth: "admin",
		responses: { 200: { description: "System presets", schema: PresetListResponseSchema } },
		handle: async () => reply.ok({ presets: (await listSystemPresets()).map(toPresetView) })
	}),
	endpoint({
		method: "post",
		path: "/admin/presets",
		summary: "Create a system preset",
		auth: "admin",
		input: { body: CreatePresetRequestSchema },
		responses: { 201: { description: "Created preset", schema: PresetViewSchema } },
		errors: [409],
		handle: async ({ input }) => reply.created(toPresetView(await createPreset(null, input.body)))
	}),
	endpoint({
		method: "get",
		path: "/admin/presets/{name}",
		summary: "Get a system preset",
		auth: "admin",
		input: { params: NameParams },
		responses: { 200: { description: "The preset", schema: PresetViewSchema } },
		errors: [404],
		handle: async ({ input }) => reply.ok(toPresetView(await findOwned(null, input.params.name)))
	}),
	endpoint({
		method: "patch",
		path: "/admin/presets/{name}",
		summary: "Update a system preset; bumps its version",
		auth: "admin",
		input: { params: NameParams, body: UpdatePresetRequestSchema },
		responses: { 200: { description: "Updated preset", schema: PresetViewSchema } },
		errors: [404, 409],
		handle: async ({ input }) => reply.ok(toPresetView(await updatePreset(null, input.params.name, input.body)))
	}),
	endpoint({
		method: "delete",
		path: "/admin/presets/{name}",
		summary: "Delete a system preset",
		auth: "admin",
		input: { params: NameParams, query: ExpectedVersionQuerySchema },
		responses: { 204: { description: "Preset deleted" } },
		errors: [404, 409],
		handle: async ({ input }) => {
			await deletePreset(null, input.params.name, input.query);
			return reply.noContent();
		}
	})
];
