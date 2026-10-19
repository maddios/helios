import type { WebhookEvent } from "@helios/contracts";

export type Envelope = Pick<WebhookEvent, "id" | "createdAt" | "sequence"> & { event: string; data: unknown };

export type AttemptOutcome =
	{ status: "DELIVERED"; httpStatus?: number } | { status: "FAILED"; httpStatus?: number; error: string };
