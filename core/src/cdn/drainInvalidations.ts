import { createHash } from "node:crypto";
import { cdnInvalidations, type CdnInvalidation } from "../models";
import { cdn } from "./cdnAdapter";

const MAX_PATHS_PER_INVALIDATION = 3000;
const MAX_WILDCARDS_PER_INVALIDATION = 15;
const SCAN_LIMIT = 500;
const MAX_ATTEMPTS = 5;

export async function drainCdnInvalidations(now: Date): Promise<void> {
	const adapter = cdn();
	if ((await adapter.invalidationsInProgress()) > 0) {
		return;
	}
	const pending = await cdnInvalidations()
		.find({ status: "PENDING" })
		.sort({ createdAt: 1 })
		.limit(SCAN_LIMIT)
		.toArray();
	const group = takeGroup(pending);
	if (group.length === 0) {
		return;
	}
	const ids = group.map((doc) => doc._id);
	let accepted: boolean;
	try {
		accepted = await adapter.createInvalidation([...new Set(group.flatMap((doc) => doc.paths))], groupReference(ids));
	} catch (err) {
		await recordFailure(ids);
		throw err;
	}
	if (accepted) {
		await cdnInvalidations().updateMany({ _id: { $in: ids } }, { $set: { status: "SENT", sentAt: now } });
	}
}

function takeGroup(pending: CdnInvalidation[]): CdnInvalidation[] {
	const group: CdnInvalidation[] = [];
	let paths = 0;
	let wildcards = 0;
	for (const doc of pending) {
		const docWildcards = doc.paths.filter((path) => path.includes("*")).length;
		const fits =
			paths + doc.paths.length <= MAX_PATHS_PER_INVALIDATION &&
			wildcards + docWildcards <= MAX_WILDCARDS_PER_INVALIDATION;
		if (group.length > 0 && !fits) {
			break;
		}
		group.push(doc);
		paths += doc.paths.length;
		wildcards += docWildcards;
	}
	return group;
}

function groupReference(ids: string[]): string {
	return `drain-${createHash("sha256")
		.update([...ids].sort().join("\n"))
		.digest("hex")
		.slice(0, 32)}`;
}

async function recordFailure(ids: string[]): Promise<void> {
	await cdnInvalidations().updateMany({ _id: { $in: ids } }, { $inc: { attempts: 1 } });
	await cdnInvalidations().updateMany(
		{ _id: { $in: ids }, attempts: { $gte: MAX_ATTEMPTS } },
		{ $set: { status: "FAILED" } }
	);
}
