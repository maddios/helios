import { forEachLimit } from "../../../src/transcribe/forEachLimit";

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("forEachLimit", () => {
	it("runs at most `limit` tasks at once and visits every item", async () => {
		let inFlight = 0;
		let peak = 0;
		const visited: number[] = [];

		await forEachLimit([1, 2, 3, 4, 5], 2, new AbortController().signal, async (item) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await tick();
			visited.push(item);
			inFlight -= 1;
		});

		expect(peak).toBe(2);
		expect(visited.sort()).toEqual([1, 2, 3, 4, 5]);
	});

	it("starts no new task after one fails, and waits for the running ones before rejecting", async () => {
		const started: number[] = [];
		const failure = new Error("boom");

		await expect(
			forEachLimit([1, 2, 3, 4], 2, new AbortController().signal, async (item, signal) => {
				started.push(item);
				await tick();
				if (item === 1) {
					throw failure;
				}
				signal.throwIfAborted();
			})
		).rejects.toBe(failure);
		expect(started).toEqual([1, 2]);
	});

	it("rejects with the outer abort reason and starts nothing new", async () => {
		const controller = new AbortController();
		const reason = new Error("stopping");
		const started: number[] = [];

		await expect(
			forEachLimit([1, 2, 3], 1, controller.signal, async (item) => {
				started.push(item);
				controller.abort(reason);
			})
		).rejects.toBe(reason);
		expect(started).toEqual([1]);
	});
});
