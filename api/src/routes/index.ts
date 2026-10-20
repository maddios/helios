import type { AnyEndpoint } from "../http/endpoint";
import { adminAccountRoutes } from "./admin/accounts";
import { adminDestinationRoutes } from "./admin/destinations";
import { adminPresetRoutes } from "./admin/presets";
import { adminUsageRoutes } from "./admin/usage";
import { assetJobRoutes } from "./assetJobs";
import { accountRoutes } from "./account";
import { assetRoutes } from "./assets";
import { destinationRoutes } from "./destinations";
import { encodeRoutes } from "./encode";
import { fileRoutes } from "./files";
import { healthRoutes } from "./health";
import { presetRoutes } from "./presets";
import { requestRoutes } from "./requests";
import { uploadRoutes } from "./uploads";
import { usageRoutes } from "./usage";

function tagged(tag: string, endpoints: AnyEndpoint[]): AnyEndpoint[] {
	return endpoints.map((spec) => ({ ...spec, tags: spec.tags ?? [tag] }));
}

export const apiEndpoints = [
	...tagged("Health", healthRoutes),
	...tagged("Encoding", [...encodeRoutes, ...assetJobRoutes]),
	...tagged("Assets", assetRoutes),
	...tagged("Uploads", uploadRoutes),
	...tagged("Files", fileRoutes),
	...tagged("Account", accountRoutes),
	...tagged("Requests", requestRoutes),
	...tagged("Presets", presetRoutes),
	...tagged("Usage", usageRoutes),
	...destinationRoutes,
	...tagged("Admin", [...adminAccountRoutes, ...adminPresetRoutes, ...adminUsageRoutes]),
	...adminDestinationRoutes
];
