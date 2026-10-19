import { requests } from "../models";

export async function nextSequence(requestId: string): Promise<number> {
	const updated = await requests().findOneAndUpdate(
		{ _id: requestId },
		{ $inc: { nextSequence: 1 } },
		{ returnDocument: "after", projection: { nextSequence: 1 } }
	);
	if (updated?.nextSequence === undefined) {
		throw new Error(`Request ${requestId} not found`);
	}
	return updated.nextSequence;
}
