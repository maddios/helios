module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	transform: { "\\.md$": "<rootDir>/api/src/openapi/guides/markdownTransform.js" },
	setupFiles: ["<rootDir>/core/test/env.ts", "<rootDir>/worker/test/env.ts", "<rootDir>/api/test/env.ts"],
	maxWorkers: 1,
	clearMocks: true,
	testTimeout: 60000,
	roots: [
		"<rootDir>/contracts",
		"<rootDir>/core",
		"<rootDir>/worker",
		"<rootDir>/api",
		"<rootDir>/functions",
		"<rootDir>/scripts"
	],
	testMatch: ["**/test/**/*.test.ts"]
};
