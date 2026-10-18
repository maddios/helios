import { enqueueAnalyze } from "../../src/pipeline";
import { queueFor } from "../../src/queue";

jest.mock("../../src/queue", () => require("../helpers/queueMock"));

describe("enqueueAnalyze", () => {
	it("sends the request id to the analyze queue without a message group", async () => {
		await enqueueAnalyze("req-7");

		expect(queueFor("analyze").send).toHaveBeenCalledWith({ body: { requestId: "req-7" } });
	});
});
