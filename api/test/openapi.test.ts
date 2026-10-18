import request from "supertest";
import OpenAPIParser from "@readme/openapi-parser";
import { ensureIndexes } from "@helios/core";
import { createApp } from "../src/app";
import { apiEndpoints } from "../src/routes";
import { toExpressPath } from "../src/http/endpoint";
import { resetDb, startMongo, stopMongo } from "../../core/test/helpers/mongo";
import { bearer, seedAccount, seedGenericPreset } from "./helpers/fixtures";

jest.mock("../../core/src/queue", () => require("../../core/test/helpers/queueMock"));

const app = createApp();
let key: string;

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
	await seedGenericPreset();
	({ key } = await seedAccount());
});

function fetchDocument() {
	return request(app).get("/openapi.json").set("Authorization", bearer(key));
}

interface ExpressLayer {
	route?: { path: string; methods: Record<string, boolean> };
	name?: string;
	handle?: { stack?: ExpressLayer[] };
}

function expressRoutes(stack: ExpressLayer[]): { path: string; method: string }[] {
	return stack.flatMap((layer) => {
		if (layer.route !== undefined) {
			return Object.keys(layer.route.methods).map((method) => ({ path: layer.route?.path ?? "", method }));
		}
		return layer.handle?.stack === undefined ? [] : expressRoutes(layer.handle.stack);
	});
}

describe("OpenAPI document", () => {
	it("serves a valid OpenAPI 3.0.3 document", async () => {
		const res = await fetchDocument();

		expect(res.status).toBe(200);
		await expect(OpenAPIParser.validate(JSON.parse(res.text))).resolves.toBeDefined();
	});

	it("documents every Express route with its method", async () => {
		const res = await fetchDocument();
		const paths = res.body.paths as Record<string, Record<string, unknown>>;
		const routerStack = (app.router as unknown as { stack: ExpressLayer[] }).stack;

		const undocumented = expressRoutes(routerStack).filter(
			(route) => paths[route.path.replace(/:(\w+)/g, "{$1}")]?.[route.method] === undefined
		);

		expect(undocumented).toEqual([]);
	});

	it("registers one Express route per endpoint spec", () => {
		const routerStack = (app.router as unknown as { stack: ExpressLayer[] }).stack;
		const registered = expressRoutes(routerStack).map((route) => `${route.method} ${route.path}`);

		for (const spec of apiEndpoints) {
			expect(registered).toContain(`${spec.method} ${toExpressPath(spec.path)}`);
		}
	});

	it("requires a key to fetch the document", async () => {
		const res = await request(app).get("/openapi.json");

		expect(res.status).toBe(401);
	});

	it("documents /openapi.json and /docs as requiring a key", async () => {
		const res = await fetchDocument();

		expect(res.body.paths["/openapi.json"].get.security).toEqual([{ accountKey: [] }, { adminKey: [] }]);
		expect(res.body.paths["/docs"].get.security).toEqual([{ accountKey: [] }, { adminKey: [] }]);
	});

	it("declares account and admin security schemes", async () => {
		const res = await fetchDocument();

		expect(res.body.components.securitySchemes).toMatchObject({
			accountKey: { type: "http", scheme: "bearer" },
			adminKey: { type: "http", scheme: "bearer" }
		});
	});
});
