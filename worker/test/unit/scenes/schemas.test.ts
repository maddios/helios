import { z } from "zod";
import { ModelSceneSchema } from "@helios/contracts";
import { sceneSchemas } from "../../../src/scenes/schemas";

function requiredEverywhere(node: unknown): boolean {
	if (Array.isArray(node)) {
		return node.every(requiredEverywhere);
	}
	if (typeof node !== "object" || node === null) {
		return true;
	}
	const { properties, required, items } = node as {
		properties?: Record<string, unknown>;
		required?: string[];
		items?: unknown;
	};
	const keys = Object.keys(properties ?? {});
	const allRequired = keys.every((key) => (required ?? []).includes(key));
	return (
		allRequired &&
		Object.values(properties ?? {}).every(requiredEverywhere) &&
		(items === undefined || requiredEverywhere(items))
	);
}

function propertiesOf(schema: z.ZodType, path: string[]): string[] {
	let node = z.toJSONSchema(schema) as { properties?: Record<string, unknown> };
	for (const key of path) {
		node = (node as Record<string, unknown>)[key] as typeof node;
	}
	return Object.keys(node.properties ?? {});
}

describe("scene schema sets", () => {
	it.each([true, false])("keeps every property required in strict mode (peopleAttributes=%s)", (people) => {
		const set = sceneSchemas(people);

		for (const schema of [set.window, set.windowed, set.image]) {
			expect(requiredEverywhere(z.toJSONSchema(schema))).toBe(true);
		}
	});

	it("includes people fields in scenes and the image summary only when people attributes are enabled", () => {
		const withPeople = sceneSchemas(true);
		const withoutPeople = sceneSchemas(false);

		expect(propertiesOf(withPeople.window, ["properties", "scenes", "items"])).toContain("people");
		expect(propertiesOf(withPeople.windowed, ["properties", "scenes", "items"])).toContain("people");
		expect(propertiesOf(withPeople.image, ["properties", "summary"])).toContain("people");
		expect(propertiesOf(withoutPeople.window, ["properties", "scenes", "items"])).not.toContain("people");
		expect(propertiesOf(withoutPeople.image, ["properties", "summary"])).not.toContain("people");
	});

	it("uses separate schemas for single-window, windowed and image-summary calls", () => {
		const set = sceneSchemas(true);

		expect(Object.keys(z.toJSONSchema(set.window).properties ?? {})).toEqual(["summary", "scenes"]);
		expect(Object.keys(z.toJSONSchema(set.windowed).properties ?? {})).toEqual(["scenes"]);
		expect(Object.keys(z.toJSONSchema(set.image).properties ?? {})).toEqual(["summary"]);
	});

	it("puts reasonForTransition before startSec in the model-facing scene", () => {
		const sceneKeys = Object.keys(ModelSceneSchema.shape);

		expect(sceneKeys.indexOf("reasonForTransition")).toBeLessThan(sceneKeys.indexOf("startSec"));
	});
});
