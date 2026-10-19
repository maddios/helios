module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	testMatch: ["**/local/test/openai.realapi.ts"],
	maxWorkers: 1,
	testTimeout: 300000
};
