import { randomBase62 } from "./randomBase62";

export type ApiKeyScope = "account" | "admin";

const PREFIXES: Record<ApiKeyScope, string> = { account: "sk_live_", admin: "sk_admin_" };

export function generateKey(scope: ApiKeyScope): string {
	return PREFIXES[scope] + randomBase62(32);
}
