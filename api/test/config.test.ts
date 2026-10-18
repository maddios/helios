describe("apiConfig", () => {
	const saved = process.env.ANALYZE_TIMEOUT_SEC;

	afterEach(() => {
		process.env.ANALYZE_TIMEOUT_SEC = saved;
	});

	it("rejects an ANALYZE_TIMEOUT_SEC above 45 at startup", () => {
		process.env.ANALYZE_TIMEOUT_SEC = "46";

		jest.isolateModules(() => {
			const { apiConfig } = require("../src/config") as typeof import("../src/config");
			expect(() => apiConfig()).toThrow("must be at most 45");
		});
	});

	it("accepts an ANALYZE_TIMEOUT_SEC of 45", () => {
		process.env.ANALYZE_TIMEOUT_SEC = "45";

		jest.isolateModules(() => {
			const { apiConfig } = require("../src/config") as typeof import("../src/config");
			expect(apiConfig().ANALYZE_TIMEOUT_SEC).toBe(45);
		});
	});
});
