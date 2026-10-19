import { config, fargateConfig, resetConfigForTests } from "../../src/config";

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
