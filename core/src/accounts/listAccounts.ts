import { accounts, type Account } from "../models";

export function listAccounts(): Promise<Account[]> {
	return accounts().find({}).sort({ createdAt: 1 }).toArray();
}
