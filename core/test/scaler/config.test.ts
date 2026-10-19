import { resetScalerConfigForTests, scalerConfig } from "../../src/scaler";

const valid = {
	ECS_CLUSTER: "helios-test",
	WORKER_TASK_DEFINITION: "helios-worker:1",
	WORKER_CONTAINER_NAME: "worker",
	WORKER_SUBNETS: " subnet-a, subnet-b ,",
	WORKER_SECURITY_GROUPS: "sg-1",
	WARM_WORKERS: "1",
	MAX_WORKERS: "5",
	WORKER_SPOT: "true"
};

describe("scalerConfig", () => {
	const original = process.env;

	function load(overrides: Record<string, string>): void {
		process.env = { ...original, ...valid, ...overrides };
		resetScalerConfigForTests();
	}

	afterEach(() => {
		process.env = original;
		resetScalerConfigForTests();
	});

	it("parses the ECS settings, trimming and splitting the CSV lists", () => {
		load({});

		expect(scalerConfig()).toEqual({
			ECS_CLUSTER: "helios-test",
			WORKER_TASK_DEFINITION: "helios-worker:1",
			WORKER_CONTAINER_NAME: "worker",
			WORKER_SUBNETS: ["subnet-a", "subnet-b"],
			WORKER_SECURITY_GROUPS: ["sg-1"],
			WARM_WORKERS: 1,
			MAX_WORKERS: 5,
			WORKER_SPOT: true
		});
	});

	it("rejects more warm workers than the maximum", () => {
		load({ WARM_WORKERS: "6" });

		expect(() => scalerConfig()).toThrow(/WARM_WORKERS: must be <= MAX_WORKERS/);
	});

	it("rejects a subnet list that is empty after trimming", () => {
		load({ WORKER_SUBNETS: " , " });

		expect(() => scalerConfig()).toThrow(/WORKER_SUBNETS/);
	});
});
