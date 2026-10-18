import { z } from "zod";

export const IdParams = z.object({ id: z.string().min(1).describe("Resource id") });
export const NameParams = z.object({ name: z.string().min(1).describe("Preset name") });
