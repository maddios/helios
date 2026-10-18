import type { ItemKind, QueueName } from "@helios/contracts";

export interface Thresholds {
	maxDurationSec: number;
	maxSourceBytes: number;
}

export interface PlannedItem {
	key: string;
	kind: ItemKind;
	profile?: string;
	queue: QueueName;
	priority: number;
	status: "QUEUED" | "BLOCKED" | "SKIPPED";
	dependsOn: string[];
}

export interface ItemMessage {
	itemId: string;
}
