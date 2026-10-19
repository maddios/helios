import {
	BrowserUploadError,
	EtagUnavailableError,
	PartUrlExpiredError,
	uploadParts,
	type MultipartUpload,
	type UploadProgress
} from "../src/browser/index.js";
import { installFakeXhr, type XhrCall, type XhrReply } from "./helpers/fakeXhr.js";

const PART = 4;
const TEN_BYTES = 10;

function upload(parts = 3): MultipartUpload {
	return {
		uploadId: "u1",
		uploadKey: "acme/uploads/0b1c2d3e-0000-4000-8000-000000000001/clip.bin",
		partSizeBytes: PART,
		parts: Array.from({ length: parts }, (_, index) => ({
			partNumber: index + 1,
			url: `https://s3.test/part-${index + 1}`
		}))
	};
}

function file(size = TEN_BYTES): Blob {
	return new Blob([new Uint8Array(size).fill(7)]);
}

function replyFor(overrides: Record<string, XhrReply> = {}) {
	return (call: XhrCall): XhrReply => overrides[call.url] ?? {};
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	throw new Error("expected the upload to reject");
}

describe("uploadParts", () => {
	let run: ReturnType<typeof installFakeXhr> | undefined;

	afterEach(() => {
		run?.restore();
		run = undefined;
	});

	it("PUTs each slice to its URL and returns the ETags sorted by part number", async () => {
		run = installFakeXhr(replyFor());

		const parts = await uploadParts(upload(), file());

		expect(run.calls.map((call) => [call.url, call.body.size])).toEqual([
			["https://s3.test/part-1", 4],
			["https://s3.test/part-2", 4],
			["https://s3.test/part-3", 2]
		]);
		expect(parts).toEqual([
			{ partNumber: 1, etag: '"part-1"' },
			{ partNumber: 2, etag: '"part-2"' },
			{ partNumber: 3, etag: '"part-3"' }
		]);
	});

	it("keeps at most `concurrency` parts in flight", async () => {
		run = installFakeXhr(() => ({ delayMs: 5 }));

		await uploadParts(upload(10), file(40), { concurrency: 3 });

		expect(run.peakInFlight).toBe(3);
	});

	it("uses a concurrency of 4 by default", async () => {
		run = installFakeXhr(() => ({ delayMs: 5 }));

		await uploadParts(upload(10), file(40));

		expect(run.peakInFlight).toBe(4);
	});

	it("reports progress that never decreases and ends at the file size", async () => {
		run = installFakeXhr(() => ({ delayMs: 2 }));
		const seen: UploadProgress[] = [];

		await uploadParts(upload(), file(), { concurrency: 1, onProgress: (progress) => seen.push(progress) });

		const uploaded = seen.map((progress) => progress.uploadedBytes);
		expect(uploaded).toEqual([...uploaded].sort((a, b) => a - b));
		expect(seen.every((progress) => progress.totalBytes === TEN_BYTES)).toBe(true);
		expect(uploaded.at(-1)).toBe(TEN_BYTES);
	});

	it("does not move progress backwards when a retried part reports from zero again", async () => {
		const replies: XhrReply[] = [{ status: 500 }];
		run = installFakeXhr(() => replies.shift() ?? {});
		const seen: number[] = [];

		await uploadParts(upload(1), file(PART), { onProgress: ({ uploadedBytes }) => seen.push(uploadedBytes) });

		expect(seen).toEqual([...seen].sort((a, b) => a - b));
		expect(seen.at(-1)).toBe(PART);
	});

	it("reads the ETag header and fails with EtagUnavailableError when storage does not expose it", async () => {
		run = installFakeXhr(replyFor({ "https://s3.test/part-2": { etag: null } }));

		const err = await rejection(uploadParts(upload(), file(), { concurrency: 1 }));

		expect(err).toBeInstanceOf(EtagUnavailableError);
		expect(err).toMatchObject({ code: "etag_unavailable", partNumber: 2 });
		expect((err as Error).message).toContain("ExposeHeaders");
	});

	it("renews a 403 part once through signParts and retries it with the new URL", async () => {
		run = installFakeXhr((call) => (call.url === "https://s3.test/part-2" ? { status: 403 } : {}));
		const signParts = jest.fn(async (partNumbers: number[]) =>
			partNumbers.map((partNumber) => ({ partNumber, url: `https://s3.test/renewed-${partNumber}` }))
		);

		const parts = await uploadParts(upload(), file(), { concurrency: 1, signParts });

		expect(signParts).toHaveBeenCalledTimes(1);
		expect(signParts).toHaveBeenCalledWith([2]);
		expect(run.calls.map((call) => call.url)).toEqual([
			"https://s3.test/part-1",
			"https://s3.test/part-2",
			"https://s3.test/renewed-2",
			"https://s3.test/part-3"
		]);
		expect(parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);
	});

	it("fails a 403 with PartUrlExpiredError when no signParts is given", async () => {
		run = installFakeXhr(replyFor({ "https://s3.test/part-1": { status: 403 } }));

		const err = await rejection(uploadParts(upload(), file()));

		expect(err).toBeInstanceOf(PartUrlExpiredError);
		expect(err).toMatchObject({ code: "part_url_expired", partNumber: 1, status: 403 });
	});

	it("fails with PartUrlExpiredError when the renewed URL is rejected too", async () => {
		run = installFakeXhr(() => ({ status: 403 }));
		const signParts = jest.fn(async (partNumbers: number[]) =>
			partNumbers.map((partNumber) => ({ partNumber, url: `https://s3.test/again-${partNumber}` }))
		);

		const err = await rejection(uploadParts(upload(1), file(PART), { signParts }));

		expect(err).toBeInstanceOf(PartUrlExpiredError);
		expect(signParts).toHaveBeenCalledTimes(1);
	});

	it("fails with PartUrlExpiredError when signParts does not return the part", async () => {
		run = installFakeXhr(() => ({ status: 403 }));

		const err = await rejection(uploadParts(upload(1), file(PART), { signParts: async () => [] }));

		expect(err).toBeInstanceOf(PartUrlExpiredError);
	});

	it("retries network errors and 5xx responses with backoff, up to maxPartRetries", async () => {
		const replies: XhrReply[] = [{ networkError: true }, { status: 503 }];
		run = installFakeXhr(() => replies.shift() ?? {});

		const parts = await uploadParts(upload(1), file(PART), { maxPartRetries: 2 });

		expect(run.calls).toHaveLength(3);
		expect(parts).toEqual([{ partNumber: 1, etag: '"part-1"' }]);
	});

	it("retries 429 responses", async () => {
		const replies: XhrReply[] = [{ status: 429 }];
		run = installFakeXhr(() => replies.shift() ?? {});

		await uploadParts(upload(1), file(PART));

		expect(run.calls).toHaveLength(2);
	});

	it("uses 3 retries by default, so a part that always fails is tried 4 times", async () => {
		run = installFakeXhr(() => ({ status: 500 }));

		const err = await rejection(uploadParts(upload(1), file(PART)));

		expect(run.calls).toHaveLength(4);
		expect(err).toMatchObject({ code: "part_rejected", partNumber: 1, status: 500 });
	});

	it("does not retry other 4xx responses", async () => {
		run = installFakeXhr(() => ({ status: 400 }));

		const err = await rejection(uploadParts(upload(1), file(PART)));

		expect(run.calls).toHaveLength(1);
		expect(err).toBeInstanceOf(BrowserUploadError);
		expect(err).toMatchObject({ code: "part_rejected", status: 400 });
	});

	it("stops after the first failing part and cancels the others in flight", async () => {
		run = installFakeXhr((call) => (call.url === "https://s3.test/part-1" ? { status: 400 } : { delayMs: 50 }));

		const err = await rejection(uploadParts(upload(4), file(16), { concurrency: 3, maxPartRetries: 0 }));

		expect(err).toMatchObject({ code: "part_rejected", partNumber: 1 });
		expect(run.abortedInFlight).toBe(2);
		expect(run.inFlight).toBe(0);
	});

	it("skips uploaded parts, counts them as uploaded, and returns their stored ETags", async () => {
		run = installFakeXhr(() => ({}));
		const seen: UploadProgress[] = [];

		const parts = await uploadParts(upload(), file(), {
			concurrency: 1,
			uploadedParts: [{ partNumber: 1, etag: '"stored-1"', sizeBytes: PART }],
			onProgress: (progress) => seen.push(progress)
		});

		expect(run.calls.map((call) => call.url)).toEqual(["https://s3.test/part-2", "https://s3.test/part-3"]);
		expect(seen[0]).toEqual({ uploadedBytes: PART, totalBytes: TEN_BYTES });
		expect(seen.at(-1)?.uploadedBytes).toBe(TEN_BYTES);
		expect(parts[0]).toEqual({ partNumber: 1, etag: '"stored-1"' });
	});

	it("uploads nothing when every part is already stored", async () => {
		run = installFakeXhr(() => ({}));

		const parts = await uploadParts(upload(1), file(PART), {
			uploadedParts: [{ partNumber: 1, etag: '"stored-1"', sizeBytes: PART }]
		});

		expect(run.calls).toHaveLength(0);
		expect(parts).toEqual([{ partNumber: 1, etag: '"stored-1"' }]);
	});

	it("rejects a stored part whose size does not match the plan", async () => {
		run = installFakeXhr(() => ({}));

		const err = await rejection(
			uploadParts(upload(), file(), { uploadedParts: [{ partNumber: 1, etag: '"x"', sizeBytes: 3 }] })
		);

		expect(err).toMatchObject({ code: "invalid_resume", partNumber: 1 });
		expect(run.calls).toHaveLength(0);
	});

	it("rejects a stored part that is not in the plan", async () => {
		run = installFakeXhr(() => ({}));

		const err = await rejection(
			uploadParts(upload(), file(), { uploadedParts: [{ partNumber: 9, etag: '"x"', sizeBytes: PART }] })
		);

		expect(err).toMatchObject({ code: "invalid_resume", partNumber: 9 });
	});

	it("aborts in-flight parts and rejects with code aborted when the signal fires", async () => {
		run = installFakeXhr(() => ({ delayMs: 100 }));
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 10);

		const err = await rejection(uploadParts(upload(4), file(16), { concurrency: 2, signal: controller.signal }));

		expect(err).toMatchObject({ code: "aborted" });
		expect(run.abortedInFlight).toBe(2);
		expect(run.calls).toHaveLength(2);
	});

	it("rejects immediately, without any PUT, when the signal is already aborted", async () => {
		run = installFakeXhr(() => ({}));
		const controller = new AbortController();
		controller.abort();

		const err = await rejection(uploadParts(upload(), file(), { signal: controller.signal }));

		expect(err).toMatchObject({ code: "aborted" });
		expect(run.calls).toHaveLength(0);
	});

	it.each([
		["concurrency of 0", { concurrency: 0 }],
		["concurrency of 17", { concurrency: 17 }],
		["a fractional concurrency", { concurrency: 1.5 }],
		["maxPartRetries of -1", { maxPartRetries: -1 }],
		["maxPartRetries of 11", { maxPartRetries: 11 }]
	])("rejects %s with invalid_option before any request", async (_label, options) => {
		run = installFakeXhr(() => ({}));

		const err = await rejection(uploadParts(upload(), file(), options));

		expect(err).toMatchObject({ code: "invalid_option" });
		expect(run.calls).toHaveLength(0);
	});

	it.each([
		["a part count that does not fit the file", () => upload(2)],
		[
			"a part number outside the plan",
			() => ({ ...upload(), parts: [{ partNumber: 4, url: "u" }, ...upload().parts.slice(1)] })
		],
		["a zero part size", () => ({ ...upload(), partSizeBytes: 0 })]
	])("rejects %s with invalid_upload before any request", async (_label, build) => {
		run = installFakeXhr(() => ({}));

		const err = await rejection(uploadParts(build(), file()));

		expect(err).toMatchObject({ code: "invalid_upload" });
		expect(run.calls).toHaveLength(0);
	});
});
