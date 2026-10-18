import express, { type RequestHandler } from "express";

const JSON_BODY_LIMIT = "1mb";

export function jsonBody(): RequestHandler {
	return express.json({ limit: JSON_BODY_LIMIT });
}
