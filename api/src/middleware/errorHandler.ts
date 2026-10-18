import type { ErrorRequestHandler } from "express";
import { errorResponse } from "../errors/errorResponse";

export function errorHandler(): ErrorRequestHandler {
	return (err, _req, res, next) => {
		if (res.headersSent) {
			next(err);
			return;
		}
		const { status, body, retryAfterSec } = errorResponse(err, res.locals.requestId);
		if (status >= 500) {
			res.locals.log.error({ err }, "request failed");
		}
		if (retryAfterSec !== undefined) {
			res.setHeader("Retry-After", String(retryAfterSec));
		}
		res.status(status).json(body);
	};
}
