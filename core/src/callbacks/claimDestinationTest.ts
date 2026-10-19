import { TooManyRequestsError } from "@helios/contracts";
import { accounts } from "../models";

const MS_PER_SEC = 1000;

export async function claimDestinationTest(accountId: string, cooldownSec: number): Promise<void> {
	const now = new Date();
	const cutoff = new Date(now.getTime() - cooldownSec * MS_PER_SEC);
	const claimed = await accounts().updateOne(
		{
			_id: accountId,
			$or: [{ lastDestinationTestAt: { $exists: false } }, { lastDestinationTestAt: { $lte: cutoff } }]
		},
		{ $set: { lastDestinationTestAt: now } }
	);
	if (claimed.matchedCount === 0) {
		const latest = await accounts().findOne({ _id: accountId });
		const readyAt = (latest?.lastDestinationTestAt?.getTime() ?? now.getTime()) + cooldownSec * MS_PER_SEC;
		throw new TooManyRequestsError(
			"destination_test_cooldown",
			"A destination test was sent recently; try again later",
			Math.ceil((readyAt - now.getTime()) / MS_PER_SEC)
		);
	}
}
