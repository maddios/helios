import type { RequestStatus, ResourceUnits, UsageSummary } from "@helios/contracts";
import type { JobReport, PipelineItem } from "../models";

export type JobReportFields = Pick<JobReport, "status" | "items" | "usage" | "resourceUnits">;

function toReportItem(item: PipelineItem): JobReport["items"][number] {
	return {
		itemId: item._id,
		kind: item.kind,
		status: item.status,
		...(item.profile !== undefined && { profile: item.profile }),
		...(item.error !== undefined && { error: item.error })
	};
}

export function buildJobReport(
	status: RequestStatus,
	items: PipelineItem[],
	usage: UsageSummary,
	resourceUnits: ResourceUnits
): JobReportFields {
	return { status, items: items.map(toReportItem), usage, resourceUnits };
}
