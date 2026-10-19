import { cdnInvalidations } from "../models";

export async function enqueueInvalidation(paths: string[], callerReference: string): Promise<void> {
	await cdnInvalidations().updateOne(
		{ _id: callerReference },
		{ $setOnInsert: { paths, status: "PENDING", attempts: 0, createdAt: new Date() } },
		{ upsert: true }
	);
}
