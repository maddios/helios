import { randomUUID } from "node:crypto";
import { clientWith } from "./helpers/client.js";
import { apiError, json, scriptedFetch } from "./helpers/fakeFetch.js";
import { requestView } from "./helpers/fixtures.js";

const SOURCE = { source: { bucket: "bella-sources", key: "clip.mp4" }, preset: "generic" };

describe("idempotency", () => {
	it("sends the same generated requestId on every retry of one create", async () => {
		const { fetch, calls } = scriptedFetch([
			apiError(503, "down"),
			apiError(500, "internal_error"),
			json(202, requestView("ANALYZING"))
		]);

		await clientWith(fetch).encodes.create(SOURCE);

		const ids = calls.map((call) => (call.body as { requestId?: string }).requestId);
		expect(calls).toHaveLength(3);
		expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
		expect(new Set(ids).size).toBe(1);
	});

	it("keeps a caller-supplied requestId", async () => {
		const requestId = randomUUID();
		const { fetch, calls } = scriptedFetch([json(202, requestView("ANALYZING"))]);

		await clientWith(fetch).encodes.create({ ...SOURCE, requestId });

		expect(calls[0]?.body).toMatchObject({ requestId });
	});

	it("generates a new requestId for each separate create", async () => {
		const { fetch, calls } = scriptedFetch([json(202, requestView("ANALYZING")), json(202, requestView("ANALYZING"))]);
		const client = clientWith(fetch);

		await client.encodes.create(SOURCE);
		await client.encodes.create(SOURCE);

		expect((calls[0]?.body as { requestId: string }).requestId).not.toBe(
			(calls[1]?.body as { requestId: string }).requestId
		);
	});

	it("reuses one requestId across a dry run and does not add one to the query", async () => {
		const { fetch, calls } = scriptedFetch([json(200, { items: [] })]);

		await clientWith(fetch).encodes.create(SOURCE, { dryRun: true });

		expect(calls[0]?.url).toBe("https://api.test/encode?dryRun=true");
		expect(calls[0]?.body).toEqual(SOURCE);
	});
});
