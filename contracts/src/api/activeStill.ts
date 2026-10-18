import { z } from "zod";
import { ActiveStillSchema } from "../outputs";

export const ActiveStillPatchSchema = z
	.object({
		index: z.int().min(0).describe("Index of the still to select")
	})
	.meta({ id: "ActiveStillPatch" });
export type ActiveStillPatch = z.infer<typeof ActiveStillPatchSchema>;

export const ActiveStillResponseSchema = z
	.object({
		activeStill: ActiveStillSchema.describe("Selected still image")
	})
	.meta({ id: "ActiveStillResponse" });
export type ActiveStillResponse = z.infer<typeof ActiveStillResponseSchema>;
