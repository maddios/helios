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

	it("requires a CDN_MODE that is cloudfront or recording", () => {
		process.env.CDN_MODE = "cdn";
		resetConfigForTests();
		expect(() => config()).toThrow(/CDN_MODE/);
	});

	it("requires CDN_DISTRIBUTION_ID in cloudfront mode", () => {
		process.env.CDN_MODE = "cloudfront";
		resetConfigForTests();
		expect(() => config()).toThrow(/CDN_DISTRIBUTION_ID/);
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

	it("rejects SSRF_ALLOWED_HOSTS outside the local stage", () => {
		process.env.STAGE = "prod";
		process.env.SSRF_ALLOWED_HOSTS = "localhost";
		resetConfigForTests();
		expect(() => config()).toThrow(/SSRF_ALLOWED_HOSTS/);
	});

	it("accepts SSRF_ALLOWED_HOSTS in the local stage and empty in prod", () => {
		process.env.SSRF_ALLOWED_HOSTS = "localhost, 127.0.0.1";
		resetConfigForTests();
		expect(config().SSRF_ALLOWED_HOSTS).toEqual(["localhost", "127.0.0.1"]);
		process.env.STAGE = "prod";
		process.env.SSRF_ALLOWED_HOSTS = "";
		resetConfigForTests();
		expect(config()).toMatchObject({ STAGE: "prod", SSRF_ALLOWED_HOSTS: [] });
	});

	it("rejects an unknown STAGE", () => {
		process.env.STAGE = "staging";
		resetConfigForTests();
		expect(() => config()).toThrow(/STAGE/);
	});

	it("throws naming a missing MONGO_URI", () => {
		delete process.env.MONGO_URI;
		resetConfigForTests();
		expect(() => config()).toThrow(/MONGO_URI/);
	});
});
