import { upload } from "../src/browser/index.js";
import { installFakeXhr } from "./helpers/fakeXhr.js";

const SINGLE_URL = "https://s3.test/a.png?X-Amz-Signature=abc";
const PART_URL = (partNumber: number) => `https://s3.test/a.bin?partNumber=${partNumber}`;

describe("upload", () => {
	let run: ReturnType<typeof installFakeXhr> | undefined;

	afterEach(() => {
		run?.restore();
		run = undefined;
	});

	it("PUTs a single-mode file and returns no parts", async () => {
		run = installFakeXhr(() => ({ status: 200 }));
		const file = new Blob(["0123"]);

		const result = await upload(
			{ mode: "single", fileId: "f1", url: SINGLE_URL, headers: { "content-type": "image/png" } },
			file
		);

		expect(result).toEqual({});
		expect(run.calls).toEqual([expect.objectContaining({ method: "PUT", url: SINGLE_URL })]);
	});

	it("uploads a multipart-mode file and returns the parts to pass to uploads.complete", async () => {
		run = installFakeXhr((call) => ({ status: 200, etag: `"etag-${call.url.split("=").pop()}"` }));
		const file = new Blob(["0123456789"]);

		const result = await upload(
			{
				mode: "multipart",
				fileId: "f1",
				uploadId: "u1",
				partSizeBytes: 4,
				parts: [
					{ partNumber: 1, url: PART_URL(1) },
					{ partNumber: 2, url: PART_URL(2) },
					{ partNumber: 3, url: PART_URL(3) }
				]
			},
			file
		);

		expect(result).toEqual({
			parts: [
				{ partNumber: 1, etag: '"etag-1"' },
				{ partNumber: 2, etag: '"etag-2"' },
				{ partNumber: 3, etag: '"etag-3"' }
			]
		});
	});
});
