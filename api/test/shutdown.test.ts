import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { closeServer } from "../src/shutdown";

function slowApp(delayMs: number) {
	const app = express();
	app.get("/slow", (_req, res) => {
		const timer = setTimeout(() => res.json({ done: true }), delayMs);
		res.on("close", () => clearTimeout(timer));
	});
	return app;
}

async function listen(app: express.Express): Promise<{ server: Server; base: string }> {
	const server = app.listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server.once("listening", () => resolve()));
	return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe("closeServer", () => {
	it("lets an in-flight request complete within the drain window", async () => {
		const { server, base } = await listen(slowApp(300));
		const inFlight = fetch(`${base}/slow`).then(async (res) => ({ status: res.status, body: await res.json() }));
		await new Promise((resolve) => setTimeout(resolve, 50));

		await closeServer(server, 2000);

		await expect(inFlight).resolves.toEqual({ status: 200, body: { done: true } });
	});

	it("force-closes a request still running after the drain window", async () => {
		const { server, base } = await listen(slowApp(10_000));
		const outcome = fetch(`${base}/slow`).then(
			() => "completed",
			() => "aborted"
		);
		await new Promise((resolve) => setTimeout(resolve, 50));

		await closeServer(server, 100);

		await expect(outcome).resolves.toBe("aborted");
	});
});
