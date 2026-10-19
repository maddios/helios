import { DescribeTasksCommand, ECSClient, ListTasksCommand, RunTaskCommand } from "@aws-sdk/client-ecs";
import { GetQueueAttributesCommand, GetQueueUrlCommand, SQSClient } from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { resetConfigForTests } from "../../src/config";
import { resetQueuesForTests } from "../../src/queue";
import { resetScalerConfigForTests, runScaler } from "../../src/scaler";

const sqsMock = mockClient(SQSClient);
const ecsMock = mockClient(ECSClient);

const BASE_ENV = {
	ECS_CLUSTER: "helios-test",
	WORKER_TASK_DEFINITION: "helios-worker:1",
	WORKER_CONTAINER_NAME: "worker",
	WORKER_SUBNETS: "subnet-a,subnet-b",
	WORKER_SECURITY_GROUPS: "sg-1",
	WARM_WORKERS: "1",
	MAX_WORKERS: "5",
	WORKER_SPOT: "false"
};

const TIERS = ["fargate-p1", "fargate-p2", "fargate-p3", "fargate-p4"] as const;
type Tier = (typeof TIERS)[number];

function backlog(counts: Partial<Record<Tier, number>>): void {
	for (const tier of TIERS) {
		const QueueUrl = `https://sqs.test/${tier}`;
		sqsMock.on(GetQueueUrlCommand, { QueueName: `helios-test-${tier}` }).resolves({ QueueUrl });
		sqsMock.on(GetQueueAttributesCommand, { QueueUrl }).resolves({
			Attributes: {
				ApproximateNumberOfMessages: String(counts[tier] ?? 0),
				ApproximateNumberOfMessagesNotVisible: "0"
			}
		});
	}
}

function running(roles: ("warm" | "burst")[]): void {
	const arns = roles.map((_, index) => `arn:task-${index}`);
	ecsMock.on(ListTasksCommand).resolves({ taskArns: arns });
	ecsMock.on(DescribeTasksCommand).resolves({
		tasks: roles.map((role, index) => ({ taskArn: arns[index], tags: [{ key: "role", value: role }] }))
	});
}

function runTask(role: "warm" | "burst", capacityProvider: "FARGATE" | "FARGATE_SPOT") {
	return {
		cluster: "helios-test",
		taskDefinition: "helios-worker:1",
		count: 1,
		startedBy: "helios-worker",
		tags: [{ key: "role", value: role }],
		capacityProviderStrategy: [{ capacityProvider, weight: 1 }],
		networkConfiguration: { awsvpcConfiguration: { subnets: ["subnet-a", "subnet-b"], securityGroups: ["sg-1"] } },
		overrides: {
			containerOverrides: [{ name: "worker", environment: [{ name: "IDLE_EXIT", value: String(role === "burst") }] }]
		}
	};
}

function startedTasks() {
	return ecsMock.commandCalls(RunTaskCommand).map((call) => call.args[0].input);
}

describe("runScaler", () => {
	const original = process.env;

	beforeEach(() => {
		process.env = { ...original, ...BASE_ENV };
		resetConfigForTests();
		resetScalerConfigForTests();
		resetQueuesForTests();
		sqsMock.reset();
		ecsMock.reset();
		ecsMock.on(RunTaskCommand).resolves({ tasks: [], failures: [] });
		running([]);
	});

	afterEach(() => {
		process.env = original;
		resetConfigForTests();
		resetScalerConfigForTests();
	});

	it("starts the missing warm worker, then on-demand burst workers", async () => {
		backlog({ "fargate-p1": 2 });

		const plan = await runScaler();

		expect(plan).toEqual({ startWarm: 1, startBurst: { onDemand: 1, spot: 0 } });
		expect(startedTasks()).toEqual([runTask("warm", "FARGATE"), runTask("burst", "FARGATE")]);
	});

	it("counts running tasks by role, follows every page, and starts burst workers with IDLE_EXIT=true", async () => {
		backlog({ "fargate-p2": 4 });
		ecsMock.reset();
		ecsMock.on(RunTaskCommand).resolves({ tasks: [], failures: [] });
		ecsMock.on(ListTasksCommand, { nextToken: undefined }).resolves({ taskArns: ["arn:task-0"], nextToken: "page-2" });
		ecsMock.on(ListTasksCommand, { nextToken: "page-2" }).resolves({ taskArns: ["arn:task-1"] });
		ecsMock.on(DescribeTasksCommand).resolves({
			tasks: [
				{ taskArn: "arn:task-0", tags: [{ key: "role", value: "warm" }] },
				{ taskArn: "arn:task-1", tags: [{ key: "role", value: "burst" }] }
			]
		});

		const plan = await runScaler();

		expect(plan).toEqual({ startWarm: 0, startBurst: { onDemand: 2, spot: 0 } });
		expect(ecsMock.commandCalls(ListTasksCommand)).toHaveLength(2);
		expect(startedTasks()).toEqual([runTask("burst", "FARGATE"), runTask("burst", "FARGATE")]);
	});

	it("starts Fargate Spot burst workers when the only backlog is p4 and WORKER_SPOT is true", async () => {
		process.env.WORKER_SPOT = "true";
		process.env.WARM_WORKERS = "0";
		resetScalerConfigForTests();
		backlog({ "fargate-p4": 2 });

		await runScaler();

		expect(startedTasks()).toEqual([runTask("burst", "FARGATE_SPOT"), runTask("burst", "FARGATE_SPOT")]);
	});

	it("logs RunTask failures without throwing", async () => {
		backlog({ "fargate-p1": 2 });
		ecsMock.on(RunTaskCommand).resolves({ tasks: [], failures: [{ reason: "RESOURCE:MEMORY" }] });

		await expect(runScaler()).resolves.toMatchObject({ startBurst: { onDemand: 1 } });
	});
});
