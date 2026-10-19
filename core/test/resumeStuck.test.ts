import type { PipelineRequest } from "../src/models";
import { ensureIndexes, requests } from "../src/models";
import { launchRequest, RESUME_BATCH_SIZE, resumeStuckRequests } from "../src/pipeline";
import { queueFor } from "../src/queue";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

jest.mock("../src/queue", () => require("./helpers/queueMock"));
jest.mock("../src/pipeline/launchRequest", () => ({ launchRequest: jest.fn() }));

const THRESHOLD_MS = 120_000;
const STUCK = new Date(Date.now() - 2 * THRESHOLD_MS);
const FRESH = new Date(Date.now() - THRESHOLD_MS / 10);

function request(fields: Record<string, unknown> & { _id: string }): PipelineRequest {
	return {
		accountId: "account-1",
		assetId: "asset-1",
		clientRequestId: fields._id,
		mode: "encode",
		analyze: "async",
		assetVersion: 1,
		pendingItems: [],
		status: "IN_PROGRESS",
		createdAt: STUCK,
		...fields
	} as unknown as PipelineRequest;
}

async function insert(...docs: PipelineRequest[]): Promise<void> {
	await requests().insertMany(docs);
}

describe("resumeStuckRequests", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
	});

	it("re-enqueues an async ANALYZING request older than the threshold", async () => {
		await insert(request({ _id: "analyzing-old", status: "ANALYZING" }));

		await resumeStuckRequests(new Date());

		expect(queueFor("analyze").send).toHaveBeenCalledWith({ body: { requestId: "analyzing-old" } });
	});

	it("skips ANALYZING requests that are fresh or analyzed synchronously", async () => {
		await insert(
			request({ _id: "analyzing-fresh", status: "ANALYZING", createdAt: FRESH }),
			request({ _id: "analyzing-sync", status: "ANALYZING", analyze: "sync" })
		);

		await resumeStuckRequests(new Date());

		expect(queueFor("analyze").send).not.toHaveBeenCalled();
	});

	it("launches an IN_PROGRESS request with no enqueuedAt that is older than the threshold", async () => {
		await insert(request({ _id: "launch-old" }));

		await resumeStuckRequests(new Date());

		expect(launchRequest).toHaveBeenCalledWith("launch-old");
	});

	it("leaves fresh, already enqueued and terminal requests alone", async () => {
		await insert(
			request({ _id: "launch-fresh", createdAt: FRESH }),
			request({ _id: "enqueued", enqueuedAt: STUCK }),
			request({ _id: "complete", status: "COMPLETE" })
		);

		await resumeStuckRequests(new Date());

		expect(launchRequest).not.toHaveBeenCalled();
		expect(queueFor("analyze").send).not.toHaveBeenCalled();
	});

	it("does not launch a request again once it has been enqueued", async () => {
		jest.mocked(launchRequest).mockImplementation(async (requestId) => {
			await requests().updateOne({ _id: requestId }, { $set: { enqueuedAt: new Date() } });
			return undefined as never;
		});
		await insert(request({ _id: "launch-once" }));

		await resumeStuckRequests(new Date());
		await resumeStuckRequests(new Date());

		expect(launchRequest).toHaveBeenCalledTimes(1);
	});

	it("bounds each run to one batch of requests", async () => {
		await insert(...Array.from({ length: RESUME_BATCH_SIZE + 50 }, (_, index) => request({ _id: `launch-${index}` })));

		await resumeStuckRequests(new Date());

		expect(launchRequest).toHaveBeenCalledTimes(RESUME_BATCH_SIZE);
	});

	it("stamps resumedAt when it resumes a request", async () => {
		await insert(request({ _id: "analyzing-stamp", status: "ANALYZING" }));

		await resumeStuckRequests(new Date());

		expect(await requests().findOne({ _id: "analyzing-stamp" })).toMatchObject({ resumedAt: expect.any(Date) });
	});

	it("skips a request resumed within the threshold and resumes it once that resume is stale", async () => {
		await insert(request({ _id: "launch-recent", resumedAt: FRESH }));

		await resumeStuckRequests(new Date());
		expect(launchRequest).not.toHaveBeenCalled();

		await resumeStuckRequests(new Date(Date.now() + 2 * THRESHOLD_MS));
		expect(launchRequest).toHaveBeenCalledWith("launch-recent");
	});

	it("keeps resuming the other requests when one of them fails", async () => {
		jest
			.mocked(launchRequest)
			.mockRejectedValueOnce(new Error("asset missing"))
			.mockResolvedValue(undefined as never);
		await insert(request({ _id: "launch-a" }), request({ _id: "launch-b", createdAt: FRESH }));
		await insert(request({ _id: "launch-c", createdAt: new Date(STUCK.getTime() + 1) }));

		await expect(resumeStuckRequests(new Date())).resolves.toBeUndefined();

		expect(launchRequest).toHaveBeenCalledTimes(2);
	});
});
