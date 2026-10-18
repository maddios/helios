import { config, resetConfigForTests } from "../src/config";

describe("config", () => {
	const original = process.env;

	beforeEach(() => {
		process.env = { ...original };
		resetConfigForTests();
	});

	afterEach(() => {
		process.env = original;
		resetConfigForTests();
	});

	it("parses a valid environment", () => {
		expect(config()).toMatchObject({
			MONGO_URI: "mongodb://unit-tests-use-memory-server.invalid",
			QUEUE_PREFIX: "helios-test",
			LAMBDA_MAX_DURATION_SEC: 180,
			LAMBDA_MAX_SOURCE_BYTES: 524288000,
			LOG_LEVEL: "fatal",
			AWS_REGION: "us-east-2",
			SQS_FAIR_QUEUES: true
		});
	});

	it("parses SQS_FAIR_QUEUES as a boolean", () => {
		process.env.SQS_FAIR_QUEUES = "false";
		resetConfigForTests();
		expect(config().SQS_FAIR_QUEUES).toBe(false);
	});

	it("rejects a SQS_FAIR_QUEUES value that is not true or false", () => {
		process.env.SQS_FAIR_QUEUES = "yes";
		resetConfigForTests();
		expect(() => config()).toThrow(/SQS_FAIR_QUEUES/);
	});

	it("throws naming the missing variable", () => {
		delete process.env.AWS_REGION;
		resetConfigForTests();
		expect(() => config()).toThrow(/AWS_REGION/);
	});

	it("throws naming a missing MONGO_URI", () => {
		delete process.env.MONGO_URI;
		resetConfigForTests();
		expect(() => config()).toThrow(/MONGO_URI/);
	});
});
