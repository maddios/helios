import { resolveSettings, type TransportOptions } from "../options.js";
import { Transport } from "../transport/transport.js";
import { AdminAccounts } from "./accounts.js";
import { AdminDestinations } from "./destinations.js";
import { AdminKeys } from "./keys.js";
import { AdminPresets } from "./presets.js";
import { AdminUsage } from "./usage.js";

/**
 * Client for operator tasks: accounts, keys, system presets, usage and destination tests.
 *
 * Use an admin key (`sk_admin_...`). Keep this client out of account-facing services, which only need `Helios`.
 *
 * @example
 * import { HeliosAdmin } from "@partnrup/helios-sdk/admin";
 * const admin = new HeliosAdmin({ apiKey: adminKey, baseUrl });
 * const { webhookSecret } = await admin.accounts.create({ slug: "bella", name: "Bella", sourceBuckets: ["bella-sources"] });
 */
export class HeliosAdmin {
	/** Creates, lists, updates accounts and rotates webhook secrets. */
	readonly accounts: AdminAccounts;
	/** Issues and revokes account API keys. */
	readonly keys: AdminKeys;
	/** Manages system presets. */
	readonly presets: AdminPresets;
	/** Reads usage across accounts. */
	readonly usage: AdminUsage;
	/** Sends test events to account destinations. */
	readonly destinations: AdminDestinations;

	/**
	 * @param options Admin API key, base URL and optional timeouts, retries and fetch.
	 * @throws {ConfigurationError} When `apiKey` is empty or `baseUrl` is not an http(s) URL.
	 * @example
	 * const admin = new HeliosAdmin({ apiKey: adminKey, baseUrl });
	 */
	constructor(options: TransportOptions) {
		const transport = new Transport(resolveSettings(options));
		this.accounts = new AdminAccounts(transport);
		this.keys = new AdminKeys(transport);
		this.presets = new AdminPresets(transport);
		this.usage = new AdminUsage(transport);
		this.destinations = new AdminDestinations(transport);
	}
}
