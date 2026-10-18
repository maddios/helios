import type { AnalyzeMode } from "@helios/contracts";
import { analyzeRequest } from "../analyze";
import type { PipelineRequest } from "../models";

export async function analyzeIfSync(request: PipelineRequest, analyze: AnalyzeMode): Promise<PipelineRequest> {
	if (analyze === "sync" && request.status === "ANALYZING") {
		return analyzeRequest(request._id);
	}
	return request;
}
