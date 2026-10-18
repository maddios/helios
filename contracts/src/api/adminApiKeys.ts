import { z } from "zod";

export const CreateApiKeyRequestSchema = z
	.object({
		name: z.string().min(1).describe("Label for the API key")
	})
	.meta({ id: "CreateApiKeyRequest" });
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;

export const ApiKeyCreatedSchema = z
	.object({
		id: z.string().describe("API key id"),
		name: z.string().describe("Label of the API key"),
		prefix: z.string().describe("Display prefix of the key, safe to show later"),
		key: z.string().describe("Plaintext key, shown once"),
		createdAt: z.iso.datetime().describe("When the key was created")
	})
	.meta({ id: "ApiKeyCreated" });
export type ApiKeyCreated = z.infer<typeof ApiKeyCreatedSchema>;
