import { MongoServerError } from "mongodb";
import {
	MongoNetworkError,
	MongoNetworkTimeoutError,
	MongoNotConnectedError,
	MongoServerSelectionError,
	MongoTopologyClosedError,
	isDatabaseUnavailableError
} from "../src/db";

describe("isDatabaseUnavailableError", () => {
	it.each([
		["a network error", () => new MongoNetworkError("connection refused")],
		["a network timeout", () => new MongoNetworkTimeoutError("socket timed out")],
		["a server selection failure", () => new MongoServerSelectionError("no server", {} as never)],
		["a client that is not connected", () => new MongoNotConnectedError("not connected")],
		["a closed topology", () => new MongoTopologyClosedError("topology closed")]
	])("treats %s as unavailable", (_name, build) => {
		expect(isDatabaseUnavailableError(build())).toBe(true);
	});

	it("ignores errors that only share the name of an unavailability error", () => {
		const lookalike = new Error("connection refused");
		lookalike.name = "MongoNetworkError";

		expect(isDatabaseUnavailableError(lookalike)).toBe(false);
	});

	it("does not treat a server error such as a duplicate key as unavailable", () => {
		expect(isDatabaseUnavailableError(new MongoServerError({ message: "duplicate key", code: 11000 }))).toBe(false);
	});

	it("does not treat unrelated errors as unavailable", () => {
		expect(isDatabaseUnavailableError(new Error("boom"))).toBe(false);
	});
});
