import { DescribeTasksCommand, ECSClient, ListTasksCommand, RunTaskCommand, type Task } from "@aws-sdk/client-ecs";
import { config } from "../config";
import { contextLogger } from "../logger";
import type { RunningWorkers } from "./planScaling";
import type { ScalerConfig } from "./config";

export const STARTED_BY = "helios-worker";
const DESCRIBE_BATCH_SIZE = 100;

export type WorkerRole = "warm" | "burst";
export type CapacityProvider = "FARGATE" | "FARGATE_SPOT";

let client: ECSClient | undefined;

function ecs(): ECSClient {
	client ??= new ECSClient({ region: config().AWS_REGION });
	return client;
}

export async function countRunning(cluster: string): Promise<RunningWorkers> {
	const tasks = await describeTasks(cluster, await listRunningTaskArns(cluster));
	const running: RunningWorkers = { warm: 0, burst: 0 };
	for (const task of tasks) {
		if (roleOf(task) === "warm") {
			running.warm += 1;
		} else {
			running.burst += 1;
		}
	}
	return running;
}

async function listRunningTaskArns(cluster: string): Promise<string[]> {
	const arns: string[] = [];
	let nextToken: string | undefined;
	do {
		const page = await ecs().send(
			new ListTasksCommand({ cluster, startedBy: STARTED_BY, desiredStatus: "RUNNING", nextToken })
		);
		arns.push(...(page.taskArns ?? []));
		nextToken = page.nextToken;
	} while (nextToken !== undefined);
	return arns;
}

async function describeTasks(cluster: string, arns: string[]): Promise<Task[]> {
	const tasks: Task[] = [];
	for (let i = 0; i < arns.length; i += DESCRIBE_BATCH_SIZE) {
		const { tasks: page = [] } = await ecs().send(
			new DescribeTasksCommand({ cluster, tasks: arns.slice(i, i + DESCRIBE_BATCH_SIZE), include: ["TAGS"] })
		);
		tasks.push(...page);
	}
	return tasks;
}

function roleOf(task: Task): string | undefined {
	return task.tags?.find((tag) => tag.key === "role")?.value;
}

export async function runWorkerTask(
	settings: ScalerConfig,
	role: WorkerRole,
	capacityProvider: CapacityProvider
): Promise<void> {
	const result = await ecs().send(
		new RunTaskCommand({
			cluster: settings.ECS_CLUSTER,
			taskDefinition: settings.WORKER_TASK_DEFINITION,
			count: 1,
			startedBy: STARTED_BY,
			tags: [{ key: "role", value: role }],
			capacityProviderStrategy: [{ capacityProvider, weight: 1 }],
			networkConfiguration: {
				awsvpcConfiguration: { subnets: settings.WORKER_SUBNETS, securityGroups: settings.WORKER_SECURITY_GROUPS }
			},
			overrides: {
				containerOverrides: [
					{
						name: settings.WORKER_CONTAINER_NAME,
						environment: [{ name: "IDLE_EXIT", value: String(role === "burst") }]
					}
				]
			}
		})
	);
	for (const failure of result.failures ?? []) {
		contextLogger({}).error({ failure }, "Worker task failed to start");
	}
}
