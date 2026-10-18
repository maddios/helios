import { main } from "../api/src/main";
import { applyLocalEnv, loadLocalConfig } from "./loadConfig";

applyLocalEnv(loadLocalConfig(), { e2e: false });

main().catch((err: unknown) => {
	console.error(err);
	process.exitCode = 1;
});
