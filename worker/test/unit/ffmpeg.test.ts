import { runFfmpeg } from "../../src/ffmpeg/run";

describe("runFfmpeg", () => {
	it("kills the running child on abort and rejects with the abort reason", async () => {
		const controller = new AbortController();
		const reason = new Error("Worker stopping");
		const run = runFfmpeg(["-re", "-f", "lavfi", "-i", "testsrc", "-t", "60", "-f", "null", "-"], {
			signal: controller.signal
		});

		setTimeout(() => controller.abort(reason), 200);

		await expect(run).rejects.toBe(reason);
	}, 30000);
});
