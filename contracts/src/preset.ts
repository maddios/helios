import { z } from "zod";
import { PostProcessDefaultsSchema } from "./postProcess";
import { EncodingProfileSchema } from "./profile";

export const PresetNameSchema = z
	.string()
	.regex(/^[a-z0-9][a-z0-9_-]{1,62}$/)
	.describe("Preset name: lowercase letters, digits, hyphens or underscores; 2 to 63 characters");

export const PresetBaseSchema = z.object({
	name: PresetNameSchema,
	version: z.int().min(1).describe("Preset version"),
	description: z.string().describe("Human-readable preset description"),
	profiles: z.array(EncodingProfileSchema).min(1).describe("Encoding profiles produced for each asset"),
	postProcess: PostProcessDefaultsSchema.describe("Default post-processing options")
});

export const PresetSchema = PresetBaseSchema.superRefine((preset, ctx) => {
	const profileNames = new Set(preset.profiles.map((profile) => profile.name));
	if (profileNames.size !== preset.profiles.length) {
		ctx.addIssue({ code: "custom", message: "Profile names must be unique", path: ["profiles"] });
	}

	const childNames = new Set(preset.profiles.flatMap((profile) => profile.children));
	for (const child of childNames) {
		if (!profileNames.has(child)) {
			ctx.addIssue({ code: "custom", message: `Unknown child profile "${child}"`, path: ["profiles"] });
		}
	}

	for (const profile of preset.profiles) {
		if (childNames.has(profile.name) && (profile.type !== "stills" || profile.isDefault)) {
			ctx.addIssue({
				code: "custom",
				message: `Child profile "${profile.name}" must be a non-default stills profile`,
				path: ["profiles"]
			});
		}
		if (profile.isDefault && profile.type !== "video" && profile.type !== "image") {
			ctx.addIssue({
				code: "custom",
				message: `Default profile "${profile.name}" must be a video or image profile`,
				path: ["profiles"]
			});
		}
	}

	const sourceTypes = new Set(preset.profiles.flatMap((profile) => profile.sourceTypes));
	for (const sourceType of sourceTypes) {
		const defaults = preset.profiles.filter((profile) => profile.isDefault && profile.sourceTypes.includes(sourceType));
		if (defaults.length !== 1) {
			ctx.addIssue({
				code: "custom",
				message: `Expected exactly one default profile for source type "${sourceType}"`,
				path: ["profiles"]
			});
		}
	}
});
export type Preset = z.infer<typeof PresetSchema>;
