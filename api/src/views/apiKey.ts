import type { ApiKeyCreated } from "@helios/contracts";
import type { ApiKey } from "@helios/core";

export function toApiKeyCreatedView(key: string, record: ApiKey): ApiKeyCreated {
	return {
		id: record._id,
		name: record.name,
		prefix: record.prefix,
		key,
		createdAt: record.createdAt.toISOString()
	};
}
