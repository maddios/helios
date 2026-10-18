import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "@helios/contracts";

export interface InputSchemas {
	params?: ZodType;
	query?: ZodType;
	body?: ZodType;
}

export function validate(schemas: InputSchemas): RequestHandler {
	return (req, res, next) => {
		res.locals.input = {
			params: parse(schemas.params, req.params),
			query: parse(schemas.query, req.query),
			body: parse(schemas.body, req.body ?? {})
		};
		next();
	};
}

function parse(schema: ZodType | undefined, value: unknown): unknown {
	if (schema === undefined) {
		return undefined;
	}
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new ValidationError("Request validation failed", result.error.issues);
	}
	return result.data;
}
