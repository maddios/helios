import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "../config";
import { UnsafeUrlError } from "./errors";
import { isPublicAddress } from "./ipRanges";

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;
export type ResolvedUrl = { url: URL; address: string; family: 4 | 6 };

export type AssertPublicUrlOptions = { resolve?: Resolver };

const DEFAULT_PORTS = new Set(["", "80", "443"]);

export function parseUrl(input: string, base?: string | URL): URL {
	try {
		return new URL(input, base);
	} catch {
		throw new UnsafeUrlError("URL is not parseable");
	}
}

export async function assertPublicUrl(input: string, options: AssertPublicUrlOptions = {}): Promise<ResolvedUrl> {
	const { STAGE, SSRF_ALLOWED_HOSTS } = config();
	const url = parseHttpUrl(input);
	if (STAGE !== "local" && !DEFAULT_PORTS.has(url.port)) {
		throw new UnsafeUrlError("URL port must be 80 or 443");
	}
	const host = bareHostname(url);
	const addresses = await resolveHost(host, options.resolve ?? resolveDns);
	const [first] = addresses;
	if (first === undefined) {
		throw new UnsafeUrlError("URL host did not resolve to any address");
	}
	const allowed = SSRF_ALLOWED_HOSTS.includes(host);
	if (!allowed && addresses.some(({ address }) => !isPublicAddress(address))) {
		throw new UnsafeUrlError("URL host resolves to a private address");
	}
	return { url, address: first.address, family: first.family };
}

function parseHttpUrl(input: string): URL {
	const url = parseUrl(input);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new UnsafeUrlError("URL scheme must be http or https");
	}
	return url;
}

function bareHostname(url: URL): string {
	return url.hostname.replace(/^\[(.*)\]$/, "$1");
}

async function resolveHost(host: string, resolve: Resolver): Promise<ResolvedAddress[]> {
	const family = isIP(host);
	if (family === 4 || family === 6) {
		return [{ address: host, family }];
	}
	return resolve(host);
}

async function resolveDns(hostname: string): Promise<ResolvedAddress[]> {
	let records;
	try {
		records = await lookup(hostname, { all: true, verbatim: true });
	} catch {
		throw new UnsafeUrlError("URL host could not be resolved");
	}
	return records.map(({ address }) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));
}
