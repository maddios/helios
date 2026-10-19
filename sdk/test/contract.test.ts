import { buildOpenApiDocument } from "../../api/src/openapi/document.js";
import { apiEndpoints } from "../../api/src/routes/index.js";
import { HeliosAdmin } from "../src/admin/client.js";
import { Helios } from "../src/client.js";
import { NON_OPERATIONS, OPERATIONS } from "./operations.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

function documentedOperations(): string[] {
	const document = buildOpenApiDocument(apiEndpoints);
	return Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
		Object.keys(item ?? {})
			.filter((method) => HTTP_METHODS.includes(method))
			.map((method) => `${method.toUpperCase()} ${path}`)
	);
}

function resolveMethod(target: object, dottedName: string): unknown {
	return dottedName
		.split(".")
		.reduce<unknown>((owner, segment) => (owner as Record<string, unknown> | undefined)?.[segment], target);
}

describe("SDK contract with the OpenAPI document", () => {
	const helios = new Helios({ apiKey: "sk_live_contract", baseUrl: "https://api.test" });
	const admin = new HeliosAdmin({ apiKey: "sk_admin_contract", baseUrl: "https://api.test" });

	it("maps every documented operation to an SDK method, and every mapped operation to a documented one", () => {
		const expected = documentedOperations()
			.filter((operation) => !NON_OPERATIONS.includes(operation))
			.sort();

		expect(Object.keys(OPERATIONS).sort()).toEqual(expected);
	});

	it("documents every operation the map lists", () => {
		expect(documentedOperations()).toEqual(expect.arrayContaining(Object.keys(OPERATIONS)));
	});

	it.each(Object.entries(OPERATIONS))("%s is implemented by %s", (_operation, method) => {
		const isAdmin = method.startsWith("admin.");
		const target = isAdmin ? admin : helios;
		const dotted = isAdmin ? method.slice("admin.".length) : method;

		expect(typeof resolveMethod(target, dotted)).toBe("function");
	});
});
