module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	transform: {
		"^.+\\.ts$": ["ts-jest", { tsconfig: { module: "commonjs" } }],
		"\\.md$": "<rootDir>/api/src/openapi/guides/markdownTransform.js"
	},
	setupFiles: ["<rootDir>/local/test/setupEnv.ts"],
	moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
	testMatch: ["**/local/test/**/*.e2e.ts"],
	maxWorkers: 1,
	testTimeout: 60000
};
