import { FARGATE_QUEUE_NAMES, type FargateQueueName } from "../queue";

export type BacklogByTier = Record<FargateQueueName, number>;

export interface RunningWorkers {
	warm: number;
	burst: number;
}

export interface ScalingInput {
	backlogByTier: BacklogByTier;
	running: RunningWorkers;
	warm: number;
	max: number;
	spot: boolean;
}

export interface ScalingPlan {
	startWarm: number;
	startBurst: { onDemand: number; spot: number };
}

export function planScaling({ backlogByTier, running, warm, max, spot }: ScalingInput): ScalingPlan {
	const startWarm = Math.max(0, warm - running.warm);
	const runningTotal = running.warm + running.burst + startWarm;
	const totalBacklog = FARGATE_QUEUE_NAMES.reduce((sum, name) => sum + backlogByTier[name], 0);
	const burst = Math.max(0, Math.min(totalBacklog, max) - runningTotal);
	const onlyP4Backlog = backlogByTier["fargate-p4"] > 0 && totalBacklog === backlogByTier["fargate-p4"];
	if (spot && onlyP4Backlog) {
		return { startWarm, startBurst: { onDemand: 0, spot: burst } };
	}
	return { startWarm, startBurst: { onDemand: burst, spot: 0 } };
}
