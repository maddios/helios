import type { RequestHandler } from "express";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@helios/contracts";
import { authenticate as verifyKey, getAccount } from "@helios/core";

export type KeyScope = "account" | "admin" | "any";

export function authenticate(scope: KeyScope): RequestHandler {
	return async (req, res, next) => {
		const key = await verifyKey(bearerToken(req.header("authorization")));
		if (scope === "any") {
			return next();
		}
		if (scope === "admin") {
			if (key.scope !== "admin") {
				throw new ForbiddenError("Admin API key required");
			}
			return next();
		}
		if (key.scope !== "account" || key.accountId === undefined) {
			throw new ForbiddenError("Account API key required");
		}
		res.locals.account = await loadAccount(key.accountId);
		res.locals.log = res.locals.log.child({ accountId: key.accountId });
		next();
	};
}

function bearerToken(header: string | undefined): string {
	const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
	if (match === null) {
		throw new UnauthorizedError();
	}
	return match[1];
}

async function loadAccount(accountId: string) {
	try {
		return await getAccount(accountId);
	} catch (err) {
		if (err instanceof NotFoundError) {
			throw new UnauthorizedError();
		}
		throw err;
	}
}
