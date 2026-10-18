import { applyLocalEnv, loadLocalConfig } from "../loadConfig";

applyLocalEnv(loadLocalConfig(), { e2e: true });
