import type { ResourceUnits } from "@helios/contracts";

export function mongoKey(name: string): string {
	return name.replaceAll("%", "%25").replaceAll(".", "%2E").replaceAll("$", "%24");
}

export function dailyIncrements(units: ResourceUnits): Record<string, number> {
	const { llmTokens, ...scalars } = units;
	const increments: Record<string, number> = {};
	for (const [field, value] of Object.entries(scalars)) {
		increments[`units.${field}`] = value;
	}
	for (const [model, tokens] of Object.entries(llmTokens)) {
		increments[`units.llmTokens.${mongoKey(model)}.input`] = tokens.input;
		increments[`units.llmTokens.${mongoKey(model)}.output`] = tokens.output;
	}
	return increments;
}

export function dayKey(accountId: string, now: Date): string {
	return `${accountId}:${now.toISOString().slice(0, 10)}`;
}
