import { resetAiConfigForTests } from "@helios/core";
import { config, fargateConfig, resetConfigForTests, validateWorkerConfig } from "../../src/config";

describe("worker config", () => {
	afterEach(() => {
		process.env.VISIBILITY_EXTENSION_SEC = "120";
		resetConfigForTests();
	});

	it("accepts a visibility extension equal to the lease", () => {
		process.env.VISIBILITY_EXTENSION_SEC = "90";
		resetConfigForTests();

		expect(config().VISIBILITY_EXTENSION_SEC).toBe(90);
	});

	it("rejects a visibility extension shorter than the lease", () => {
		process.env.VISIBILITY_EXTENSION_SEC = "60";
		resetConfigForTests();

		expect(() => config()).toThrow(/VISIBILITY_EXTENSION_SEC: VISIBILITY_EXTENSION_SEC must be >= LEASE_SEC/);
	});
});

describe("worker transcription config", () => {
	afterEach(() => {
		process.env.TRANSCRIBE_OVERLAP_SEC = "5";
		process.env.TRANSCRIBE_MAX_UPLOAD_BYTES = String(20 * 1024 * 1024);
		process.env.TRANSLATE_EFFORT = "low";
		resetConfigForTests();
	});

	it("rejects an overlap that is not shorter than the chunk", () => {
		process.env.TRANSCRIBE_OVERLAP_SEC = "1200";
		resetConfigForTests();

		expect(() => config()).toThrow(/TRANSCRIBE_OVERLAP_SEC must be < TRANSCRIBE_CHUNK_SEC/);
	});

	it("rejects an upload limit that cannot hold one chunk window plus its overlaps", () => {
		process.env.TRANSCRIBE_MAX_UPLOAD_BYTES = String((1200 + 2 * 5) * 4000);
		resetConfigForTests();

		expect(() => config()).toThrow(/TRANSCRIBE_MAX_UPLOAD_BYTES/);
	});

	it("rejects an upload limit at or above the 25 MiB provider limit", () => {
		process.env.TRANSCRIBE_MAX_UPLOAD_BYTES = String(25 * 1024 * 1024);
		resetConfigForTests();

		expect(() => config()).toThrow(/TRANSCRIBE_MAX_UPLOAD_BYTES must be < 25 MiB/);
	});

	it("rejects an unknown translation effort", () => {
		process.env.TRANSLATE_EFFORT = "extreme";
		resetConfigForTests();

		expect(() => config()).toThrow(/TRANSLATE_EFFORT/);
	});
});

describe("worker startup validation", () => {
	afterEach(() => {
		process.env.OPENAI_MAX_RETRY_AFTER_SEC = "30";
		resetAiConfigForTests();
		resetConfigForTests();
	});

	it("accepts the test environment", () => {
		expect(() => validateWorkerConfig()).not.toThrow();
	});

	it("fails at startup when the AI config is missing a required setting", () => {
		delete process.env.OPENAI_MAX_RETRY_AFTER_SEC;
		resetAiConfigForTests();

		expect(() => validateWorkerConfig()).toThrow(/OPENAI_MAX_RETRY_AFTER_SEC/);
	});
});

describe("worker config for the lambda tier", () => {
	const original = process.env;
	const FARGATE_ONLY = ["WORKER_VCPU", "WORKER_SPOT", "WORKER_MEMORY_MB", "IDLE_EXIT", "WORKER_IDLE_TIMEOUT_SEC"];

	beforeEach(() => {
		process.env = { ...original, WORKER_TIER: "lambda", AWS_LAMBDA_FUNCTION_MEMORY_SIZE: "4096" };
		for (const name of FARGATE_ONLY) {
			delete process.env[name];
		}
		resetConfigForTests();
	});

	afterEach(() => {
		process.env = original;
		resetConfigForTests();
	});

	it("needs no fargate-only settings and reads memory from the Lambda runtime", () => {
		expect(config()).toMatchObject({ WORKER_TIER: "lambda", AWS_LAMBDA_FUNCTION_MEMORY_SIZE: 4096 });
	});

	it("rejects the lambda tier without the Lambda memory size", () => {
		delete process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
		resetConfigForTests();

		expect(() => config()).toThrow(/AWS_LAMBDA_FUNCTION_MEMORY_SIZE/);
	});

	it("rejects polling queues outside the fargate tier", () => {
		expect(() => fargateConfig()).toThrow(/WORKER_TIER=fargate/);
	});
});
