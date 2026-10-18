import type { ActiveStill, StillItem } from "@helios/contracts";

function nearestIndex(items: StillItem[], timestampSec: number): number {
	let best = 0;
	for (let index = 1; index < items.length; index++) {
		if (Math.abs(items[index].timestampSec - timestampSec) < Math.abs(items[best].timestampSec - timestampSec)) {
			best = index;
		}
	}
	return best;
}

export function pickActiveStill(previous: ActiveStill | undefined, items: StillItem[]): ActiveStill {
	if (items.length === 0) {
		throw new Error("Cannot pick an active still from an empty list");
	}
	if (previous?.selectedByUser) {
		const index = nearestIndex(items, previous.timestampSec);
		return { index, timestampSec: items[index].timestampSec, selectedByUser: true };
	}
	return { index: 0, timestampSec: items[0].timestampSec, selectedByUser: false };
}
