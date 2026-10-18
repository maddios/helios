import { NotFoundError } from "@helios/contracts";
import { accounts, type Account } from "../models";

export async function getAccount(id: string): Promise<Account> {
	const account = await accounts().findOne({ _id: id });
	if (!account) {
		throw new NotFoundError("Account not found");
	}
	return account;
}
