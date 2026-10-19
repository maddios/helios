module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	transform: { "\\.md$": "<rootDir>/api/src/openapi/guides/markdownTransform.js" },
	setupFiles: ["<rootDir>/local/test/setupEnv.ts"],
	testMatch: ["**/local/test/**/*.e2e.ts"],
	maxWorkers: 1,
	testTimeout: 60000
};
