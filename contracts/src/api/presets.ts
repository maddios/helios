import { z } from "zod";
import { AudioProfileSchema, ImageProfileSchema, StillsProfileSchema, VideoProfileSchema } from "../profile";
import { PresetBaseSchema, PresetNameSchema } from "../preset";
import { PostProcessDefaultsSchema, PostProcessRequestSchema } from "../postProcess";
import { RequestModeSchema } from "../statuses";
import { SourceMetadataSchema, SourceTypeSchema } from "../sourceMetadata";

export const PresetScopeSchema = z
	.enum(["account", "system"])
	.describe("Whether the preset belongs to an account or is a system preset");
export type PresetScope = z.infer<typeof PresetScopeSchema>;

export const PresetViewSchema = PresetBaseSchema.extend({
	scope: PresetScopeSchema.describe("Whether the preset belongs to an account or is a system preset")
}).meta({ id: "PresetView" });
export type PresetView = z.infer<typeof PresetViewSchema>;

export const PresetListResponseSchema = z
	.object({
		presets: z.array(PresetViewSchema).describe("Presets visible to the account")
	})
	.meta({ id: "PresetList" });
export type PresetListResponse = z.infer<typeof PresetListResponseSchema>;

export const ProfileInputSchema = z
	.discriminatedUnion("type", [
		VideoProfileSchema.omit({ version: true }),
		StillsProfileSchema.omit({ version: true }),
		AudioProfileSchema.omit({ version: true }),
		ImageProfileSchema.omit({ version: true })
	])
	.describe("Encoding profile; the server sets its version to 1");
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export const ExpectedVersionSchema = z
	.int()
	.min(1)
	.describe("Preset version you last read; the write fails with 409 preset_version_conflict if it has changed");

export const ExpectedVersionQuerySchema = z
	.object({
		expectedVersion: z.coerce
			.number()
			.int()
			.min(1)
			.describe("Preset version you last read; the write fails with 409 preset_version_conflict if it has changed")
	})
	.meta({ id: "ExpectedVersionQuery" });
export type ExpectedVersionQuery = z.infer<typeof ExpectedVersionQuerySchema>;

export const CreatePresetRequestSchema = PresetBaseSchema.omit({ version: true, profiles: true })
	.extend({
		profiles: z.array(ProfileInputSchema).min(1).describe("Encoding profiles produced for each asset")
	})
	.meta({ id: "CreatePresetRequest" });
export type CreatePresetRequest = z.infer<typeof CreatePresetRequestSchema>;

export const UpdatePresetRequestSchema = z
	.object({
		expectedVersion: ExpectedVersionSchema,
		description: z.string().optional().describe("New human-readable description"),
		postProcess: PostProcessDefaultsSchema.optional().describe("New default post-processing options")
	})
	.meta({ id: "UpdatePresetRequest" });
export type UpdatePresetRequest = z.infer<typeof UpdatePresetRequestSchema>;

export const AddProfileRequestSchema = z
	.object({
		expectedVersion: ExpectedVersionSchema,
		profile: ProfileInputSchema.describe("Profile to add to the preset")
	})
	.meta({ id: "AddProfileRequest" });
export type AddProfileRequest = z.infer<typeof AddProfileRequestSchema>;

export const ProfilePatchSchema = z
	.object({
		priority: z.int().optional().describe("Scheduling priority of the profile's item"),
		isDefault: z.boolean().optional().describe("Whether this profile is the default for its source types"),
		sourceTypes: z.array(SourceTypeSchema).min(1).optional().describe("Source types this profile applies to"),
		children: z.array(z.string()).optional().describe("Names of child profiles"),
		output: z.string().optional().describe("Output filename template"),
		params: z
			.record(z.string(), z.unknown())
			.optional()
			.describe("Profile parameters merged into the existing params; the result is validated by the core")
	})
	.meta({ id: "ProfilePatch" });
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

export const UpdateProfileRequestSchema = ProfilePatchSchema.extend({
	expectedVersion: ExpectedVersionSchema
}).meta({ id: "UpdateProfileRequest" });
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const ClonePresetRequestSchema = z
	.object({
		name: PresetNameSchema.describe("Name of the new preset")
	})
	.meta({ id: "ClonePresetRequest" });
export type ClonePresetRequest = z.infer<typeof ClonePresetRequestSchema>;

export const DryRunRequestSchema = z
	.object({
		assetId: z.string().optional().describe("Plan against this existing asset"),
		sourceMetadata: SourceMetadataSchema.optional().describe("Plan against this source metadata"),
		postProcess: PostProcessRequestSchema.optional().describe("Post-processing to plan with"),
		mode: RequestModeSchema.exclude(["purge"]).optional().describe("Request mode to plan")
	})
	.refine((request) => (request.assetId === undefined) !== (request.sourceMetadata === undefined), {
		message: "Provide exactly one of assetId or sourceMetadata"
	})
	.meta({ id: "DryRunRequest" });
export type DryRunRequest = z.infer<typeof DryRunRequestSchema>;
