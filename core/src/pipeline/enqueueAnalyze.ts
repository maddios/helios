import { queueFor } from "../queue";
import type { AnalyzeMessage } from "./types";

export async function enqueueAnalyze(requestId: string): Promise<void> {
	await queueFor<AnalyzeMessage>("analyze").send({ body: { requestId } });
}
