module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	setupFiles: ["<rootDir>/local/test/setupEnv.ts"],
	testMatch: ["**/local/test/**/*.e2e.ts"],
	maxWorkers: 1,
	testTimeout: 60000
};
