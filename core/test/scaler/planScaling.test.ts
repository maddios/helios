import { planScaling, type BacklogByTier, type ScalingInput } from "../../src/scaler";

const none: BacklogByTier = { "fargate-p1": 0, "fargate-p2": 0, "fargate-p3": 0, "fargate-p4": 0 };
const backlog = (overrides: Partial<BacklogByTier>): BacklogByTier => ({ ...none, ...overrides });

interface Case {
	name: string;
	input: Omit<ScalingInput, "backlogByTier"> & { backlogByTier?: Partial<BacklogByTier> };
	startWarm: number;
	onDemand: number;
	spot: number;
}

const cases: Case[] = [
	{
		name: "starts nothing with no backlog and no warm target",
		input: { running: { warm: 0, burst: 0 }, warm: 0, max: 5, spot: false },
		startWarm: 0,
		onDemand: 0,
		spot: 0
	},
	{
		name: "keeps the warm target alive when nothing is running",
		input: { running: { warm: 0, burst: 0 }, warm: 1, max: 5, spot: false },
		startWarm: 1,
		onDemand: 0,
		spot: 0
	},
	{
		name: "does not start a warm worker that is already running",
		input: { running: { warm: 1, burst: 0 }, warm: 1, max: 5, spot: false },
		startWarm: 0,
		onDemand: 0,
		spot: 0
	},
	{
		name: "starts only the missing warm workers",
		input: { running: { warm: 1, burst: 0 }, warm: 3, max: 5, spot: false },
		startWarm: 2,
		onDemand: 0,
		spot: 0
	},
	{
		name: "never starts a negative number of warm workers",
		input: { running: { warm: 4, burst: 0 }, warm: 1, max: 5, spot: false },
		startWarm: 0,
		onDemand: 0,
		spot: 0
	},
	{
		name: "starts one burst worker per backlog message up to max",
		input: { backlogByTier: { "fargate-p1": 3 }, running: { warm: 0, burst: 0 }, warm: 0, max: 10, spot: false },
		startWarm: 0,
		onDemand: 3,
		spot: 0
	},
	{
		name: "caps burst workers at max",
		input: { backlogByTier: { "fargate-p1": 3 }, running: { warm: 0, burst: 0 }, warm: 0, max: 2, spot: false },
		startWarm: 0,
		onDemand: 2,
		spot: 0
	},
	{
		name: "subtracts running burst workers from the target",
		input: { backlogByTier: { "fargate-p2": 5 }, running: { warm: 0, burst: 2 }, warm: 0, max: 10, spot: false },
		startWarm: 0,
		onDemand: 3,
		spot: 0
	},
	{
		name: "never starts a negative number of burst workers",
		input: { backlogByTier: { "fargate-p2": 2 }, running: { warm: 0, burst: 4 }, warm: 0, max: 10, spot: false },
		startWarm: 0,
		onDemand: 0,
		spot: 0
	},
	{
		name: "counts the warm worker it starts against max",
		input: { backlogByTier: { "fargate-p1": 4 }, running: { warm: 0, burst: 0 }, warm: 1, max: 3, spot: false },
		startWarm: 1,
		onDemand: 2,
		spot: 0
	},
	{
		name: "counts a running warm worker against max",
		input: { backlogByTier: { "fargate-p1": 1 }, running: { warm: 1, burst: 0 }, warm: 1, max: 1, spot: false },
		startWarm: 0,
		onDemand: 0,
		spot: 0
	},
	{
		name: "uses Fargate Spot when the only backlog is p4 and spot is enabled",
		input: { backlogByTier: { "fargate-p4": 3 }, running: { warm: 0, burst: 0 }, warm: 0, max: 10, spot: true },
		startWarm: 0,
		onDemand: 0,
		spot: 3
	},
	{
		name: "uses on-demand when p4 is mixed with another tier, even if spot is enabled",
		input: {
			backlogByTier: { "fargate-p1": 1, "fargate-p4": 3 },
			running: { warm: 0, burst: 0 },
			warm: 0,
			max: 10,
			spot: true
		},
		startWarm: 0,
		onDemand: 4,
		spot: 0
	},
	{
		name: "uses on-demand for a p4 backlog when spot is disabled",
		input: { backlogByTier: { "fargate-p4": 3 }, running: { warm: 0, burst: 0 }, warm: 0, max: 10, spot: false },
		startWarm: 0,
		onDemand: 3,
		spot: 0
	},
	{
		name: "uses on-demand for a p3 backlog even if spot is enabled",
		input: { backlogByTier: { "fargate-p3": 2 }, running: { warm: 0, burst: 0 }, warm: 0, max: 10, spot: true },
		startWarm: 0,
		onDemand: 2,
		spot: 0
	},
	{
		name: "counts running burst workers before choosing the spot target",
		input: { backlogByTier: { "fargate-p4": 3 }, running: { warm: 0, burst: 2 }, warm: 0, max: 10, spot: true },
		startWarm: 0,
		onDemand: 0,
		spot: 1
	},
	{
		name: "counts in-flight messages in the backlog, so a busy worker is not double counted",
		input: { backlogByTier: { "fargate-p2": 2 }, running: { warm: 0, burst: 1 }, warm: 0, max: 10, spot: false },
		startWarm: 0,
		onDemand: 1,
		spot: 0
	},
	{
		name: "starts nothing for spot with no backlog",
		input: { running: { warm: 0, burst: 0 }, warm: 0, max: 10, spot: true },
		startWarm: 0,
		onDemand: 0,
		spot: 0
	}
];

describe("planScaling", () => {
	it.each(cases)("$name", ({ input, startWarm, onDemand, spot }) => {
		const plan = planScaling({ ...input, backlogByTier: backlog(input.backlogByTier ?? {}) });

		expect(plan).toEqual({ startWarm, startBurst: { onDemand, spot } });
	});
});
