import type { ItemKind } from "@helios/contracts";
import { NoHandlerError, handlerFor } from "../../src/handlers/registry";

describe("handler registry", () => {
	it("registers the encode and transcribe handlers", () => {
		expect(typeof handlerFor("encode")).toBe("function");
		expect(typeof handlerFor("transcribe")).toBe("function");
		expect(typeof handlerFor("scenes")).toBe("function");
	});

	it("throws NoHandlerError for an unregistered item kind", () => {
		expect(() => handlerFor("unknown" as ItemKind)).toThrow(NoHandlerError);
	});
});
