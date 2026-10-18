import { startHeartbeat } from "../../src/heartbeat";

describe("startHeartbeat", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("never overlaps beats: the next one is scheduled only after the previous one settles", async () => {
		let finish = () => undefined as void;
		const beat = jest.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		);
		const stop = startHeartbeat({ intervalSec: 1, beat, onError: jest.fn() });

		await jest.advanceTimersByTimeAsync(5000);
		expect(beat).toHaveBeenCalledTimes(1);

		finish();
		await jest.advanceTimersByTimeAsync(1000);
		expect(beat).toHaveBeenCalledTimes(2);
		stop();
	});

	it("reports a failed beat and retries on the next tick", async () => {
		const beat = jest.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(undefined);
		const onError = jest.fn();
		const stop = startHeartbeat({ intervalSec: 1, beat, onError });

		await jest.advanceTimersByTimeAsync(2000);

		expect(onError).toHaveBeenCalledWith(expect.any(Error));
		expect(beat).toHaveBeenCalledTimes(2);
		stop();
	});

	it("stop cancels the pending tick", async () => {
		const beat = jest.fn().mockResolvedValue(undefined);
		const stop = startHeartbeat({ intervalSec: 1, beat, onError: jest.fn() });

		stop();
		await jest.advanceTimersByTimeAsync(5000);

		expect(beat).not.toHaveBeenCalled();
	});

	it("stop during an in-flight beat prevents any further tick", async () => {
		let finish = () => undefined as void;
		const beat = jest.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		);
		const stop = startHeartbeat({ intervalSec: 1, beat, onError: jest.fn() });
		await jest.advanceTimersByTimeAsync(1000);

		stop();
		finish();
		await jest.advanceTimersByTimeAsync(5000);

		expect(beat).toHaveBeenCalledTimes(1);
	});
});
