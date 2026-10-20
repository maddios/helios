import { ingestFileFromUrl } from "@helios/core";
import { isFileIngest, runFileIngest } from "../../src/fileIngest";

jest.mock("@helios/core", () => ({ ...jest.requireActual("@helios/core"), ingestFileFromUrl: jest.fn() }));

describe("file ingest dispatch", () => {
	it("tells file ingest messages from item messages by their body", () => {
		expect(isFileIngest({ fileId: "f1" })).toBe(true);
		expect(isFileIngest({ itemId: "i1" })).toBe(false);
	});

	it("acknowledges a successful ingest", async () => {
		jest.mocked(ingestFileFromUrl).mockResolvedValue(undefined);

		const signal = new AbortController().signal;

		await expect(runFileIngest("f1", signal)).resolves.toBe("done");
		expect(ingestFileFromUrl).toHaveBeenCalledWith("f1", { signal });
	});

	it("leaves a failed ingest for redelivery", async () => {
		jest.mocked(ingestFileFromUrl).mockRejectedValue(new Error("s3 is down"));

		await expect(runFileIngest("f1", new AbortController().signal)).resolves.toBe("redeliver");
	});
});
