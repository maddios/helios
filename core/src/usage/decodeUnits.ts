import type { ResourceUnits } from "@helios/contracts";
import { decodeMongoKey } from "./decodeMongoKey";

export function decodeUnits(units: ResourceUnits): ResourceUnits {
	const llmTokens = Object.fromEntries(
		Object.entries(units.llmTokens).map(([model, tokens]) => [decodeMongoKey(model), tokens])
	);
	return { ...units, llmTokens };
}
