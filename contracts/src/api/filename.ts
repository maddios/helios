import { z } from "zod";

export const filenameField = z
	.string()
	.min(1)
	.max(255)
	.refine((name) => !name.startsWith("."), "Filename must not start with a dot");
