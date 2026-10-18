import { isIP } from "node:net";

type Cidr = { network: bigint; shift: bigint };

const IPV4_BLOCKED = [
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"224.0.0.0/4",
	"240.0.0.0/4"
].map((cidr) => parseCidr(cidr, 4));

const IPV6_GLOBAL_UNICAST = parseCidr("2000::/3", 6);

const IPV6_BLOCKED = [
	"2001::/23",
	"2001::/32",
	"2001:db8::/32",
	"2002::/16",
	"3fff::/20",
	"64:ff9b::/96",
	"64:ff9b:1::/48"
].map((cidr) => parseCidr(cidr, 6));

export function isPublicAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) {
		return !matchesAny(IPV4_BLOCKED, ipv4ToBigInt(address));
	}
	if (family === 6) {
		const value = ipv6ToBigInt(address);
		return matchesAny([IPV6_GLOBAL_UNICAST], value) && !matchesAny(IPV6_BLOCKED, value);
	}
	return false;
}

function matchesAny(ranges: Cidr[], value: bigint): boolean {
	return ranges.some(({ network, shift }) => value >> shift === network);
}

function parseCidr(cidr: string, family: 4 | 6): Cidr {
	const [address, prefix] = cidr.split("/") as [string, string];
	const bits = family === 4 ? 32n : 128n;
	const shift = bits - BigInt(prefix);
	const value = family === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);
	return { network: value >> shift, shift };
}

function ipv4ToBigInt(address: string): bigint {
	return address.split(".").reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}

function ipv6ToBigInt(address: string): bigint {
	const groups = expandIpv6(embedIpv4Tail(address));
	return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function embedIpv4Tail(address: string): string {
	const match = /\d+\.\d+\.\d+\.\d+$/.exec(address);
	if (match === null) {
		return address;
	}
	const value = ipv4ToBigInt(match[0]);
	const hextets = `${(value >> 16n).toString(16)}:${(value & 0xffffn).toString(16)}`;
	return address.slice(0, match.index) + hextets;
}

function expandIpv6(address: string): string[] {
	const [head, tail] = address.split("::") as [string, string?];
	if (tail === undefined) {
		return address.split(":");
	}
	const left = head === "" ? [] : head.split(":");
	const right = tail === "" ? [] : tail.split(":");
	const missing = 8 - left.length - right.length;
	return [...left, ...Array<string>(missing).fill("0"), ...right];
}
