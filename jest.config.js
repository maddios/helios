const SHARED = {
	preset: "ts-jest",
	testEnvironment: "node",
	setupFiles: ["<rootDir>/core/test/env.ts", "<rootDir>/worker/test/env.ts", "<rootDir>/api/test/env.ts"],
	clearMocks: true,
	testTimeout: 60000,
	testMatch: ["**/test/**/*.test.ts"]
};

module.exports = {
	maxWorkers: 1,
	projects: [
		{
			...SHARED,
			displayName: "monorepo",
			transform: { "\\.md$": "<rootDir>/api/src/openapi/guides/markdownTransform.js" },
			roots: [
				"<rootDir>/contracts",
				"<rootDir>/core",
				"<rootDir>/worker",
				"<rootDir>/api",
				"<rootDir>/functions",
				"<rootDir>/scripts"
			]
		},
		{
			...SHARED,
			displayName: "sdk",
			transform: {
				"^.+\\.ts$": ["ts-jest", { tsconfig: { module: "commonjs" } }],
				"\\.md$": "<rootDir>/api/src/openapi/guides/markdownTransform.js"
			},
			moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
			roots: ["<rootDir>/sdk"]
		}
	]
};
