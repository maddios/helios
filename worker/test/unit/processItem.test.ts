import type { PipelineItem } from "@helios/core";
import {
	accounts,
	claimItem,
	completeItem,
	contextLogger,
	mediaAssets,
	recordFailedAttempt,
	releaseLease,
	renewLease,
	requests
} from "@helios/core";
import { config, resetConfigForTests } from "../../src/config";
import { FfmpegError } from "../../src/ffmpeg/run";
import { handlerFor } from "../../src/handlers/registry";
import { SupersededError } from "../../src/handlers/supersession";
import { processItem, type ProcessItemInput } from "../../src/processItem";

jest.mock("@helios/core", () => ({
	...jest.requireActual("@helios/core"),
	claimItem: jest.fn(),
	completeItem: jest.fn(),
	recordFailedAttempt: jest.fn(),
	releaseLease: jest.fn(),
	renewLease: jest.fn(),
	mediaAssets: jest.fn(),
	accounts: jest.fn(),
	requests: jest.fn(),
	contextLogger: jest.fn()
}));
jest.mock("../../src/handlers/registry", () => ({ handlerFor: jest.fn() }));

const item = {
	_id: "req-1:mp4_360",
	requestId: "req-1",
	assetId: "asset-1",
	accountId: "acc-1",
	kind: "encode",
	profile: "mp4_360",
	status: "IN_PROGRESS"
} as unknown as PipelineItem;

const request = { _id: "req-1", status: "IN_PROGRESS" };
const asset = { _id: "asset-1", accountId: "acc-1", activeStill: undefined };
const LEASE_ID = "lease-1";

function input(overrides: Partial<ProcessItemInput> = {}): ProcessItemInput {
	return {
		itemId: item._id,
		messageId: "msg-1",
		extendVisibility: jest.fn().mockResolvedValue(undefined),
		signal: new AbortController().signal,
		...overrides
	};
}

function claimed() {
	jest.mocked(claimItem).mockResolvedValue({ claimed: true, item, request, leaseId: LEASE_ID } as never);
}

function handlerThat(run: unknown) {
	jest.mocked(handlerFor).mockReturnValue(run as never);
}

function abortableHandler() {
	let markStarted = () => undefined as void;
	const started = new Promise<void>((resolve) => {
		markStarted = resolve;
	});
	const run = (ctx: { signal: AbortSignal }) =>
		new Promise((_, reject) => {
			markStarted();
			ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
		});
	return { run, started };
}

describe("processItem", () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.mocked(contextLogger).mockReturnValue({ info: jest.fn(), error: jest.fn(), warn: jest.fn() } as never);
		jest.mocked(mediaAssets).mockReturnValue({ findOne: jest.fn().mockResolvedValue(asset) } as never);
		jest.mocked(accounts).mockReturnValue({ findOne: jest.fn().mockResolvedValue({ slug: "acme" }) } as never);
		jest.mocked(requests).mockReturnValue({ findOne: jest.fn().mockResolvedValue({ status: "IN_PROGRESS" }) } as never);
		jest.mocked(renewLease).mockResolvedValue(true);
	});

	afterEach(() => {
		jest.useRealTimers();
		resetConfigForTests();
	});

	it("returns done without running anything when the item is not claimable", async () => {
		jest.mocked(claimItem).mockResolvedValue({ claimed: false, reason: "not-claimable" });

		await expect(processItem(input())).resolves.toBe("done");

		expect(handlerFor).not.toHaveBeenCalled();
		expect(completeItem).not.toHaveBeenCalled();
	});

	it("leaves the message unacked when the busy holder is this same message", async () => {
		jest.mocked(claimItem).mockResolvedValue({ claimed: false, reason: "busy", messageId: "msg-1" });

		await expect(processItem(input())).resolves.toBe("redeliver");

		expect(completeItem).not.toHaveBeenCalled();
	});

	it("acks a duplicate delivery when a different message holds the lease, because the holder's message covers recovery", async () => {
		jest.mocked(claimItem).mockResolvedValue({ claimed: false, reason: "busy", messageId: "msg-other" });

		await expect(processItem(input())).resolves.toBe("done");

		expect(completeItem).not.toHaveBeenCalled();
	});

	it("reruns the handoff of a terminal item with its stored status", async () => {
		jest.mocked(claimItem).mockResolvedValue({ claimed: false, reason: "terminal", status: "COMPLETE" });

		await expect(processItem(input())).resolves.toBe("done");

		expect(completeItem).toHaveBeenCalledWith({ itemId: item._id, status: "COMPLETE" });
	});

	it("completes the item with its output and fargate usage on success", async () => {
		claimed();
		handlerThat(jest.fn().mockResolvedValue({ output: { assetOutputs: {} }, outputBytes: 100 }));

		await expect(processItem(input())).resolves.toBe("done");

		expect(completeItem).toHaveBeenCalledWith({
			itemId: item._id,
			status: "COMPLETE",
			output: { assetOutputs: {} },
			usage: {
				computeTier: "fargate",
				computeSec: expect.any(Number),
				memoryMb: 2048,
				vcpu: 1,
				spot: false,
				outputBytes: 100
			}
		});
	});

	it("completes as CANCELLED with the attempt usage when the request is cancelled during a heartbeat", async () => {
		claimed();
		jest.mocked(requests).mockReturnValue({ findOne: jest.fn().mockResolvedValue({ status: "CANCELLED" }) } as never);
		const { run, started } = abortableHandler();
		handlerThat(run);
		const extendVisibility = jest.fn().mockResolvedValue(undefined);

		const outcome = processItem(input({ extendVisibility }));
		await started;
		await jest.advanceTimersByTimeAsync(config().HEARTBEAT_SEC * 1000);

		await expect(outcome).resolves.toBe("done");
		expect(extendVisibility).toHaveBeenCalledWith(config().VISIBILITY_EXTENSION_SEC);
		expect(completeItem).toHaveBeenCalledWith({
			itemId: item._id,
			status: "CANCELLED",
			usage: expect.objectContaining({ computeTier: "fargate" })
		});
		expect(recordFailedAttempt).not.toHaveBeenCalled();
	});

	it("stops without completing or recording when the lease was lost during a heartbeat", async () => {
		claimed();
		jest.mocked(renewLease).mockResolvedValue(false);
		const { run, started } = abortableHandler();
		handlerThat(run);

		const outcome = processItem(input());
		await started;
		await jest.advanceTimersByTimeAsync(config().HEARTBEAT_SEC * 1000);

		await expect(outcome).resolves.toBe("redeliver");

		expect(renewLease).toHaveBeenCalledWith(item._id, LEASE_ID, 0);
		expect(completeItem).not.toHaveBeenCalled();
		expect(recordFailedAttempt).not.toHaveBeenCalled();
	});

	it("keeps running and logs when a heartbeat renewal rejects", async () => {
		claimed();
		const warn = jest.fn();
		jest.mocked(contextLogger).mockReturnValue({ info: jest.fn(), error: jest.fn(), warn } as never);
		jest.mocked(renewLease).mockRejectedValueOnce(new Error("mongo down"));
		let markStarted = () => undefined as void;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		let finish = () => undefined as void;
		handlerThat(
			() =>
				new Promise((resolve) => {
					markStarted();
					finish = () => resolve({ output: { assetOutputs: {} }, outputBytes: 1 });
				})
		);

		const outcome = processItem(input());
		await started;
		await jest.advanceTimersByTimeAsync(config().HEARTBEAT_SEC * 1000);
		finish();

		await expect(outcome).resolves.toBe("done");
		expect(warn).toHaveBeenCalledWith({ err: expect.any(Error) }, expect.stringContaining("Heartbeat failed"));
		expect(completeItem).toHaveBeenCalledWith(expect.objectContaining({ status: "COMPLETE" }));
	});

	it("returns redeliver and writes nothing when the lease is lost just before completing", async () => {
		claimed();
		jest.mocked(renewLease).mockResolvedValue(false);
		handlerThat(jest.fn().mockResolvedValue({ output: { assetOutputs: {} }, outputBytes: 1 }));

		await expect(processItem(input())).resolves.toBe("redeliver");

		expect(completeItem).not.toHaveBeenCalled();
		expect(recordFailedAttempt).not.toHaveBeenCalled();
	});

	it("records the attempt usage and the error under the lease, then rethrows", async () => {
		claimed();
		handlerThat(jest.fn().mockRejectedValue(new Error("boom")));

		await expect(processItem(input())).rejects.toThrow("boom");

		expect(recordFailedAttempt).toHaveBeenCalledWith({
			itemId: item._id,
			leaseId: LEASE_ID,
			usage: expect.objectContaining({ computeTier: "fargate" }),
			error: "boom"
		});
		expect(completeItem).not.toHaveBeenCalled();
	});

	it("stores the ffmpeg stderr tail as the error", async () => {
		claimed();
		handlerThat(jest.fn().mockRejectedValue(new FfmpegError(1, "bad codec")));

		await expect(processItem(input())).rejects.toThrow(FfmpegError);

		expect(recordFailedAttempt).toHaveBeenCalledWith(expect.objectContaining({ error: "bad codec" }));
	});

	it("records a failure that happens while loading the asset", async () => {
		claimed();
		jest.mocked(mediaAssets).mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) } as never);

		await expect(processItem(input())).rejects.toThrow(/not found/);

		expect(recordFailedAttempt).toHaveBeenCalledWith(expect.objectContaining({ leaseId: LEASE_ID }));
		expect(handlerFor).not.toHaveBeenCalled();
	});

	it("releases the lease with the attempt usage and returns interrupted when stopped mid-encode", async () => {
		claimed();
		const controller = new AbortController();
		handlerThat(async (ctx: { signal: AbortSignal }) => {
			controller.abort(new Error("Worker stopping"));
			ctx.signal.throwIfAborted();
		});

		const outcome = processItem(input({ signal: controller.signal }));

		await expect(outcome).resolves.toBe("interrupted");
		expect(releaseLease).toHaveBeenCalledWith(item._id, LEASE_ID, expect.objectContaining({ computeTier: "fargate" }));
		expect(completeItem).not.toHaveBeenCalled();
		expect(recordFailedAttempt).not.toHaveBeenCalled();
	});

	it("still reports interrupted on SIGTERM when the lease was lost, so the caller requeues the message", async () => {
		claimed();
		jest.mocked(renewLease).mockResolvedValue(false);
		const controller = new AbortController();
		const { run, started } = abortableHandler();
		handlerThat(run);

		const outcome = processItem(input({ signal: controller.signal }));
		await started;
		controller.abort(new Error("Worker stopping"));

		await expect(outcome).resolves.toBe("interrupted");
		expect(releaseLease).toHaveBeenCalledWith(item._id, LEASE_ID, expect.any(Object));
	});

	it("skips the item with the superseded reason and the attempt usage when the asset moved to a newer version", async () => {
		claimed();
		handlerThat(jest.fn().mockRejectedValue(new SupersededError(3)));

		await expect(processItem(input())).resolves.toBe("done");

		expect(completeItem).toHaveBeenCalledWith({
			itemId: item._id,
			status: "SKIPPED",
			error: "superseded by asset version 3",
			usage: expect.objectContaining({ computeTier: "fargate" })
		});
		expect(recordFailedAttempt).not.toHaveBeenCalled();
	});
});
