module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	setupFiles: ["<rootDir>/core/test/env.ts", "<rootDir>/worker/test/env.ts"],
	maxWorkers: 1,
	clearMocks: true,
	testTimeout: 60000,
	roots: ["<rootDir>/contracts", "<rootDir>/core", "<rootDir>/worker"],
	testMatch: ["**/test/**/*.test.ts"]
};
