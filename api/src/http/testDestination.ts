import { ValidationError, type Destination } from "@helios/contracts";
import { claimDestinationTest, sendTestEvent, type Account } from "@helios/core";
import { apiConfig } from "../config";
import { reply, type Reply } from "./reply";

export async function testDestination(account: Account, destination: Destination | undefined): Promise<Reply> {
	const target = destination ?? account.destination;
	if (target === undefined) {
		throw new ValidationError("No destination to test: set one on the account or supply destination in the body");
	}
	await claimDestinationTest(account._id, apiConfig().DESTINATION_TEST_COOLDOWN_SEC);
	return reply.ok(await sendTestEvent(target, account._id));
}
