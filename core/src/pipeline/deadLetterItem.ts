import { isOptionalKind } from "@helios/contracts";
import { contextLogger } from "../logger";
import { pipelineItems } from "../models";
import { completeItem } from "./completeItem";

export async function failDeadItem(itemId: string): Promise<void> {
	const item = await pipelineItems().findOne({ _id: itemId });
	if (item === null) {
		contextLogger({ itemId }).error("Dead-letter item not found; acknowledged without action");
		return;
	}
	const status = isOptionalKind(item.kind) ? "SKIPPED" : "ERROR";
	await completeItem({ itemId, status, ...(item.error !== undefined && { error: item.error }) });
}
