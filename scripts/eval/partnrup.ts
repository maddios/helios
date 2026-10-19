import { z } from "zod";
import type { Baseline } from "./types";

const TIMESTAMP = /^(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/;

const EntrySchema = z.object({
	timestamp: z.unknown(),
	reason_for_scene_transition: z.string().nullish(),
	description: z.string().nullish()
});

export function parseTimestamp(value: unknown): number | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const match = TIMESTAMP.exec(value.trim());
	if (match === null) {
		return undefined;
	}
	const [, hours, minutes, seconds, fraction = "0"] = match;
	if (Number(minutes) >= 60 || Number(seconds) >= 60) {
		return undefined;
	}
	return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction}`);
}

export function normalizePartnrup(raw: unknown, durationSec: number): Baseline {
	const entries: unknown[] = Array.isArray(raw) ? raw : [];
	const valid = entries
		.flatMap((entry) => {
			const parsed = EntrySchema.safeParse(entry);
			const startSec = parsed.success ? parseTimestamp(parsed.data.timestamp) : undefined;
			if (!parsed.success || startSec === undefined || startSec < 0 || startSec >= durationSec) {
				return [];
			}
			return [
				{
					startSec,
					reason: parsed.data.reason_for_scene_transition ?? "",
					description: parsed.data.description ?? ""
				}
			];
		})
		.sort((a, b) => a.startSec - b.startSec);
	return {
		scenes: valid.map((scene, index) => ({ ...scene, endSec: valid[index + 1]?.startSec ?? durationSec })),
		invalidCount: entries.length - valid.length
	};
}
