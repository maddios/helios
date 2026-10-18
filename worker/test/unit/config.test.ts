import { config, resetConfigForTests } from "../../src/config";

describe("worker config", () => {
	afterEach(() => {
		process.env.VISIBILITY_EXTENSION_SEC = "120";
		resetConfigForTests();
	});

	it("accepts a visibility extension equal to the lease", () => {
		process.env.VISIBILITY_EXTENSION_SEC = "90";
		resetConfigForTests();

		expect(config().VISIBILITY_EXTENSION_SEC).toBe(90);
	});

	it("rejects a visibility extension shorter than the lease", () => {
		process.env.VISIBILITY_EXTENSION_SEC = "60";
		resetConfigForTests();

		expect(() => config()).toThrow(/VISIBILITY_EXTENSION_SEC: VISIBILITY_EXTENSION_SEC must be >= LEASE_SEC/);
	});
});
