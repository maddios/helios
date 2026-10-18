import { adminAccountRoutes } from "./admin/accounts";
import { adminPresetRoutes } from "./admin/presets";
import { adminUsageRoutes } from "./admin/usage";
import { assetJobRoutes } from "./assetJobs";
import { assetRoutes } from "./assets";
import { encodeRoutes } from "./encode";
import { fileRoutes } from "./files";
import { healthRoutes } from "./health";
import { presetRoutes } from "./presets";
import { requestRoutes } from "./requests";
import { uploadRoutes } from "./uploads";
import { usageRoutes } from "./usage";

export const apiEndpoints = [
	...healthRoutes,
	...encodeRoutes,
	...assetJobRoutes,
	...assetRoutes,
	...uploadRoutes,
	...fileRoutes,
	...requestRoutes,
	...presetRoutes,
	...usageRoutes,
	...adminAccountRoutes,
	...adminPresetRoutes,
	...adminUsageRoutes
];
