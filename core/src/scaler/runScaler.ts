import { FARGATE_QUEUE_NAMES, queueFor } from "../queue";
import { countRunning, runWorkerTask, type CapacityProvider, type WorkerRole } from "./fleet";
import { scalerConfig, type ScalerConfig } from "./config";
import { planScaling, type BacklogByTier, type ScalingPlan } from "./planScaling";

export async function runScaler(): Promise<ScalingPlan> {
	const settings = scalerConfig();
	const backlogByTier = await readBacklog();
	const running = await countRunning(settings.ECS_CLUSTER);
	const plan = planScaling({
		backlogByTier,
		running,
		warm: settings.WARM_WORKERS,
		max: settings.MAX_WORKERS,
		spot: settings.WORKER_SPOT
	});
	await startTasks(settings, plan);
	return plan;
}

async function readBacklog(): Promise<BacklogByTier> {
	const entries = await Promise.all(
		FARGATE_QUEUE_NAMES.map(async (name) => [name, await queueFor<unknown>(name).approximateBacklog()] as const)
	);
	return Object.fromEntries(entries) as BacklogByTier;
}

async function startTasks(settings: ScalerConfig, plan: ScalingPlan): Promise<void> {
	await startEach(settings, "warm", "FARGATE", plan.startWarm);
	await startEach(settings, "burst", "FARGATE", plan.startBurst.onDemand);
	await startEach(settings, "burst", "FARGATE_SPOT", plan.startBurst.spot);
}

async function startEach(
	settings: ScalerConfig,
	role: WorkerRole,
	capacityProvider: CapacityProvider,
	count: number
): Promise<void> {
	await Promise.all(Array.from({ length: count }, () => runWorkerTask(settings, role, capacityProvider)));
}
