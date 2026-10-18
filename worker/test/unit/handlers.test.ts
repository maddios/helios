import { NoHandlerError, handlerFor } from "../../src/handlers/registry";

describe("handler registry", () => {
	it("registers the encode handler", () => {
		expect(typeof handlerFor("encode")).toBe("function");
	});

	it("throws NoHandlerError for an unregistered item kind", () => {
		expect(() => handlerFor("transcribe")).toThrow(NoHandlerError);
	});
});
