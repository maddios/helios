import type { ComputeTier, Usage, UsageSummary } from "@helios/contracts";

type TierTotals = NonNullable<UsageSummary["byTier"][ComputeTier]>;

export function summarizeUsage(usages: Usage[]): UsageSummary {
	const byTier: UsageSummary["byTier"] = {};
	for (const usage of usages) {
		byTier[usage.computeTier] = addTier(byTier[usage.computeTier], usage);
	}
	return { byTier };
}

function addTier(total: TierTotals | undefined, usage: Usage): TierTotals {
	return {
		attempts: (total?.attempts ?? 0) + 1,
		computeSec: (total?.computeSec ?? 0) + usage.computeSec,
		...sumOptional("outputBytes", total?.outputBytes, usage.outputBytes),
		...sumOptional("audioSec", total?.audioSec, usage.audioSec)
	};
}

function sumOptional<K extends string>(key: K, total: number | undefined, value: number | undefined) {
	if (value === undefined) {
		return total === undefined ? {} : { [key]: total };
	}
	return { [key]: (total ?? 0) + value };
}
