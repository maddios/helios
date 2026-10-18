import type { JobReport, PipelineItem } from "../models";

export function toReportItems(items: PipelineItem[]): JobReport["items"] {
	return items.map((item) => ({
		itemId: item._id,
		kind: item.kind,
		status: item.status,
		...(item.profile !== undefined && { profile: item.profile }),
		...(item.error !== undefined && { error: item.error })
	}));
}
