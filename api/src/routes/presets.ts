import {
	AddProfileRequestSchema,
	ClonePresetRequestSchema,
	CreatePresetRequestSchema,
	DryRunRequestSchema,
	DryRunResponseSchema,
	ExpectedVersionQuerySchema,
	PresetListResponseSchema,
	PresetViewSchema,
	UpdatePresetRequestSchema,
	UpdateProfileRequestSchema
} from "@helios/contracts";
import {
	addProfile,
	clonePreset,
	createPreset,
	deletePreset,
	listPresets,
	planPreset,
	removeProfile,
	resolvePreset,
	updatePreset,
	updateProfile
} from "@helios/core";
import { z } from "zod";
import { endpoint } from "../http/endpoint";
import { reply } from "../http/reply";
import { toPresetView } from "../views/preset";
import { NameParams } from "./params";

const ProfileParams = NameParams.extend({ profile: z.string().min(1).describe("Profile name") });

export const presetRoutes = [
	endpoint({
		method: "get",
		path: "/presets",
		summary: "List presets visible to the account, including system presets",
		auth: "account",
		responses: { 200: { description: "Presets", schema: PresetListResponseSchema } },
		handle: async ({ account }) => reply.ok({ presets: (await listPresets(account._id)).map(toPresetView) })
	}),
	endpoint({
		method: "post",
		path: "/presets",
		summary: "Create an account preset",
		auth: "account",
		input: { body: CreatePresetRequestSchema },
		responses: { 201: { description: "Created preset", schema: PresetViewSchema } },
		errors: [409],
		handle: async ({ account, input }) => reply.created(toPresetView(await createPreset(account._id, input.body)))
	}),
	endpoint({
		method: "get",
		path: "/presets/{name}",
		summary: "Get a preset by name",
		auth: "account",
		input: { params: NameParams },
		responses: { 200: { description: "The preset", schema: PresetViewSchema } },
		errors: [404],
		handle: async ({ account, input }) => reply.ok(toPresetView(await resolvePreset(account._id, input.params.name)))
	}),
	endpoint({
		method: "patch",
		path: "/presets/{name}",
		summary: "Update preset metadata; bumps the preset version",
		auth: "account",
		input: { params: NameParams, body: UpdatePresetRequestSchema },
		responses: { 200: { description: "Updated preset", schema: PresetViewSchema } },
		errors: [403, 404, 409],
		handle: async ({ account, input }) =>
			reply.ok(toPresetView(await updatePreset(account._id, input.params.name, input.body)))
	}),
	endpoint({
		method: "delete",
		path: "/presets/{name}",
		summary: "Delete an account preset",
		auth: "account",
		input: { params: NameParams, query: ExpectedVersionQuerySchema },
		responses: { 204: { description: "Preset deleted" } },
		errors: [403, 404, 409],
		handle: async ({ account, input }) => {
			await deletePreset(account._id, input.params.name, input.query);
			return reply.noContent();
		}
	}),
	endpoint({
		method: "post",
		path: "/presets/{name}/profiles",
		summary: "Add a profile to a preset",
		auth: "account",
		input: { params: NameParams, body: AddProfileRequestSchema },
		responses: { 200: { description: "Updated preset", schema: PresetViewSchema } },
		errors: [403, 404, 409],
		handle: async ({ account, input }) =>
			reply.ok(toPresetView(await addProfile(account._id, input.params.name, input.body)))
	}),
	endpoint({
		method: "patch",
		path: "/presets/{name}/profiles/{profile}",
		summary: "Update a profile; bumps the preset and profile versions",
		auth: "account",
		input: { params: ProfileParams, body: UpdateProfileRequestSchema },
		responses: { 200: { description: "Updated preset", schema: PresetViewSchema } },
		errors: [403, 404, 409],
		handle: async ({ account, input }) =>
			reply.ok(toPresetView(await updateProfile(account._id, input.params.name, input.params.profile, input.body)))
	}),
	endpoint({
		method: "delete",
		path: "/presets/{name}/profiles/{profile}",
		summary: "Remove a profile from a preset",
		auth: "account",
		input: { params: ProfileParams, query: ExpectedVersionQuerySchema },
		responses: { 200: { description: "Updated preset", schema: PresetViewSchema } },
		errors: [403, 404, 409],
		handle: async ({ account, input }) =>
			reply.ok(toPresetView(await removeProfile(account._id, input.params.name, input.params.profile, input.query)))
	}),
	endpoint({
		method: "post",
		path: "/presets/{name}/clone",
		summary: "Clone a preset (system or account) into a new account preset",
		auth: "account",
		input: { params: NameParams, body: ClonePresetRequestSchema },
		responses: { 201: { description: "Cloned preset", schema: PresetViewSchema } },
		errors: [404, 409],
		handle: async ({ account, input }) =>
			reply.created(toPresetView(await clonePreset(account._id, input.params.name, input.body.name)))
	}),
	endpoint({
		method: "post",
		path: "/presets/{name}/dry-run",
		summary: "Plan the items a preset would create, without writing",
		auth: "account",
		input: { params: NameParams, body: DryRunRequestSchema },
		responses: { 200: { description: "Planned items", schema: DryRunResponseSchema } },
		errors: [404],
		handle: async ({ account, input }) => reply.ok(await planPreset(account._id, input.params.name, input.body))
	})
];
