import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { contextLogger } from "@helios/core";

const HEADER = "x-request-id";
const VALID_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestId(): RequestHandler {
	return (req, res, next) => {
		const incoming = req.header(HEADER);
		const id = incoming !== undefined && VALID_ID.test(incoming) ? incoming : randomUUID();
		const startedAt = Date.now();
		res.setHeader(HEADER, id);
		res.locals.requestId = id;
		res.locals.log = contextLogger({ requestId: id });
		res.on("finish", () => {
			res.locals.log.info(
				{ method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - startedAt },
				"request finished"
			);
		});
		next();
	};
}
