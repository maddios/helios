import { BrowserUploadError, uploadSingle, type UploadProgress } from "../src/browser/index.js";
import { installFakeXhr } from "./helpers/fakeXhr.js";

const URL_ = "https://s3.test/clip.mp4?X-Amz-Signature=abc";

describe("uploadSingle", () => {
	let run: ReturnType<typeof installFakeXhr> | undefined;

	afterEach(() => {
		run?.restore();
		run = undefined;
	});

	it("PUTs the whole file with the presigned headers and reports progress", async () => {
		run = installFakeXhr(() => ({}));
		const seen: UploadProgress[] = [];
		const body = new Blob(["0123456789"]);

		await uploadSingle({ url: URL_, headers: { "content-type": "video/mp4" } }, body, {
			onProgress: (progress) => seen.push(progress)
		});

		expect(run.calls).toEqual([
			expect.objectContaining({ method: "PUT", url: URL_, headers: { "content-type": "video/mp4" }, body })
		]);
		expect(seen.at(-1)).toEqual({ uploadedBytes: 10, totalBytes: 10 });
	});

	it("rejects a rejected PUT with upload_failed and its status, without retrying", async () => {
		run = installFakeXhr(() => ({ status: 403 }));

		const err = await uploadSingle({ url: URL_, headers: {} }, new Blob(["x"])).catch((caught: unknown) => caught);

		expect(err).toBeInstanceOf(BrowserUploadError);
		expect(err).toMatchObject({ code: "upload_failed", status: 403 });
		expect(run.calls).toHaveLength(1);
	});

	it("rejects with aborted when the signal fires", async () => {
		run = installFakeXhr(() => ({ delayMs: 100 }));
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 10);

		const err = await uploadSingle({ url: URL_, headers: {} }, new Blob(["x"]), { signal: controller.signal }).catch(
			(caught: unknown) => caught
		);

		expect(err).toMatchObject({ code: "aborted" });
		expect(run.abortedInFlight).toBe(1);
	});
});
