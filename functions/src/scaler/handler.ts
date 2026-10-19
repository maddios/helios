import { resumeStuckRequests, runScaler } from "@helios/core";
import { connectOnce } from "../runtime/connect";

export async function handler(): Promise<void> {
	await connectOnce();
	const results = await Promise.allSettled([runScaler(), resumeStuckRequests(new Date())]);
	const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
	if (failures.length > 0) {
		throw new AggregateError(failures, "Scaler run failed");
	}
}
