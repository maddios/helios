module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	setupFiles: ["<rootDir>/core/test/env.ts", "<rootDir>/worker/test/env.ts"],
	roots: ["<rootDir>/worker"],
	testMatch: ["**/worker/test/golden/**/*.golden.ts"],
	maxWorkers: 1,
	testTimeout: 300000
};
