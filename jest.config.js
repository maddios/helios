module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	setupFiles: ["<rootDir>/core/test/env.ts"],
	maxWorkers: 1,
	clearMocks: true,
	testTimeout: 60000,
	roots: ["<rootDir>/contracts", "<rootDir>/core"],
	testMatch: ["**/test/**/*.test.ts"]
};
