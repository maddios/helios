import type { ItemKind, ItemStatus, QueueName } from "@helios/contracts";

export interface Thresholds {
	maxDurationSec: number;
	maxSourceBytes: number;
}

export interface Dependency {
	key: string;
	required: boolean;
}

export interface PlannedItem {
	key: string;
	kind: ItemKind;
	profile?: string;
	queue: QueueName;
	priority: number;
	status: "QUEUED" | "BLOCKED" | "SKIPPED";
	dependsOn: Dependency[];
}

export interface ItemMessage {
	itemId: string;
}

export type CallbackMessage =
	{ type: "item"; requestId: string; itemId: string } | { type: "request"; requestId: string };

export const TERMINAL_STATUSES = ["COMPLETE", "ERROR", "SKIPPED", "CANCELLED"] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export function isTerminal(status: ItemStatus): status is TerminalStatus {
	return (TERMINAL_STATUSES as readonly ItemStatus[]).includes(status);
}

export function isFailed(status: ItemStatus): boolean {
	return status === "ERROR" || status === "SKIPPED" || status === "CANCELLED";
}
