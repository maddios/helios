import { ConflictError } from "@helios/contracts";
import { apiKeys } from "../models";
import { createApiKey } from "./createApiKey";

export async function bootstrapAdminKey(): Promise<string> {
	if ((await apiKeys().countDocuments({ scope: "admin" })) > 0) {
		throw new ConflictError("An admin key already exists");
	}
	const { key } = await createApiKey({ scope: "admin", name: "bootstrap" });
	return key;
}
