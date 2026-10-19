import { AbortedError, TimeoutError } from "../src/index.js";
import { clientWith } from "./helpers/client.js";
import { json, routedFetch, scriptedFetch } from "./helpers/fakeFetch.js";
import { requestView } from "./helpers/fixtures.js";

describe("requests.wait", () => {
	it("polls until the request is COMPLETE", async () => {
		const { fetch, calls } = scriptedFetch([
			json(200, requestView("IN_PROGRESS")),
			json(200, requestView("IN_PROGRESS")),
			json(200, requestView("COMPLETE"))
		]);

		const view = await clientWith(fetch).requests.wait("r1", { intervalMs: 1 });

		expect(view.status).toBe("COMPLETE");
		expect(calls).toHaveLength(3);
	});

	it("returns an ERROR request without throwing", async () => {
		const { fetch } = scriptedFetch([json(200, requestView("ERROR"))]);

		await expect(clientWith(fetch).requests.wait("r1", { intervalMs: 1 })).resolves.toMatchObject({ status: "ERROR" });
	});

	it("throws TimeoutError when the request is still running at the deadline", async () => {
		const { fetch } = routedFetch(() => json(200, requestView("IN_PROGRESS")));

		await expect(clientWith(fetch).requests.wait("r1", { timeoutMs: 20, intervalMs: 1 })).rejects.toBeInstanceOf(
			TimeoutError
		);
	});

	it("throws AbortedError when the signal fires during a wait", async () => {
		const { fetch } = routedFetch(() => json(200, requestView("IN_PROGRESS")));
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 10);

		await expect(
			clientWith(fetch).requests.wait("r1", { intervalMs: 10_000, signal: controller.signal })
		).rejects.toBeInstanceOf(AbortedError);
	});
});
