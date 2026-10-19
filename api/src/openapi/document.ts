import {
	OpenAPIRegistry,
	OpenApiGeneratorV3,
	type ResponseConfig,
	type RouteConfig
} from "@asteasolutions/zod-to-openapi";
import { ErrorBodySchema } from "@helios/contracts";
import type { ZodObject, ZodType } from "zod";
import type { AnyEndpoint } from "../http/endpoint";
import { eventbridgeGuide, webhooksGuide } from "./guides";

const SECURITY_SCHEME: Record<"account" | "admin", string> = { account: "accountKey", admin: "adminKey" };

const ERROR_DESCRIPTIONS: Record<number, string> = {
	400: "Request validation failed",
	401: "Missing, invalid or revoked API key",
	403: "API key lacks the required scope",
	404: "Resource not found",
	409: "Conflict with the current state",
	413: "Request body is too large",
	422: "Request cannot be processed",
	429: "Too many requests; retry after the Retry-After delay",
	503: "Service unavailable; retry after the Retry-After delay"
};

const ANY_KEY_SECURITY: Record<string, string[]>[] = [{ accountKey: [] }, { adminKey: [] }];

const AUTHENTICATED_PATHS: RouteConfig[] = [
	{
		method: "get",
		path: "/openapi.json",
		summary: "OpenAPI document",
		tags: ["Health"],
		security: ANY_KEY_SECURITY,
		responses: {
			200: { description: "OpenAPI 3.0.3 document" },
			401: jsonResponse(ERROR_DESCRIPTIONS[401], ErrorBodySchema)
		}
	},
	{
		method: "get",
		path: "/docs",
		summary: "Interactive API reference (Swagger UI)",
		tags: ["Health"],
		security: ANY_KEY_SECURITY,
		responses: {
			200: { description: "Swagger UI" },
			401: jsonResponse(ERROR_DESCRIPTIONS[401], ErrorBodySchema)
		}
	}
];

export function buildOpenApiDocument(endpoints: AnyEndpoint[]) {
	const registry = new OpenAPIRegistry();
	registry.registerComponent("securitySchemes", "accountKey", {
		type: "http",
		scheme: "bearer",
		description: "Account API key (sk_live_...)"
	});
	registry.registerComponent("securitySchemes", "adminKey", {
		type: "http",
		scheme: "bearer",
		description: "Admin API key (sk_admin_...)"
	});
	for (const spec of endpoints) {
		registry.registerPath(routeOf(spec));
	}
	for (const route of AUTHENTICATED_PATHS) {
		registry.registerPath(route);
	}
	return new OpenApiGeneratorV3(registry.definitions).generateDocument({
		openapi: "3.0.3",
		info: { title: "Helios API", version: "0.1.0", description: "Encoding and post-processing API" },
		tags: [
			{ name: "Destinations", description: eventbridgeGuide },
			{ name: "Webhooks", description: webhooksGuide }
		]
	});
}

function routeOf(spec: AnyEndpoint): RouteConfig {
	const { input } = spec;
	return {
		method: spec.method,
		path: spec.path,
		summary: spec.summary,
		security: spec.auth === "none" ? [] : [{ [SECURITY_SCHEME[spec.auth]]: [] }],
		tags: spec.tags,
		request: {
			...(input?.params !== undefined && { params: input.params as ZodObject }),
			...(input?.query !== undefined && { query: input.query as ZodObject }),
			...(input?.body !== undefined && { body: { content: { "application/json": { schema: input.body } } } })
		},
		responses: responsesOf(spec)
	};
}

function responsesOf(spec: AnyEndpoint): Record<string, ResponseConfig> {
	const responses: Record<string, ResponseConfig> = {};
	for (const [status, response] of Object.entries(spec.responses)) {
		responses[status] = jsonResponse(response.description, response.schema);
	}
	for (const status of errorStatusesOf(spec)) {
		responses[String(status)] = jsonResponse(ERROR_DESCRIPTIONS[status], ErrorBodySchema);
	}
	return responses;
}

function errorStatusesOf(spec: AnyEndpoint): number[] {
	const statuses = [...(spec.errors ?? []), 503];
	if (spec.input !== undefined) {
		statuses.push(400);
	}
	if (spec.input?.body !== undefined) {
		statuses.push(413);
	}
	if (spec.auth !== "none") {
		statuses.push(401, 403);
	}
	return [...new Set(statuses)];
}

function jsonResponse(description: string, schema?: ZodType): ResponseConfig {
	return schema === undefined ? { description } : { description, content: { "application/json": { schema } } };
}
