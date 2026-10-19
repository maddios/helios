import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { AbortedError, UploadError, WebhookError, Webhooks } from "../src/index.js";
import { forEachBounded } from "../src/uploads/pool.js";
import { clientWith } from "./helpers/client.js";
import { json, routedFetch, type Call } from "./helpers/fakeFetch.js";

const STORAGE = "https://s3.test";
const NO_CONTENT = (): Response => new Response(null, { status: 204 });

function createdFor(partSizeBytes: number, count: number) {
	return {
		uploadId: "u1",
		uploadKey: "uploads/acme/clip.bin",
		partSizeBytes,
		parts: Array.from({ length: count }, (_, index) => ({ partNumber: index + 1, url: `${STORAGE}/part/${index + 1}` }))
	};
}

function multipartFetch(partSizeBytes: number, count: number) {
	return routedFetch((call: Call) => {
		if (call.method === "POST") return json(201, createdFor(partSizeBytes, count));
		if (call.method === "PUT") return new Response(null, { status: 200, headers: { etag: '"e"' } });
		return NO_CONTENT();
	});
}

function methodsOf(calls: Call[]): string[] {
	return calls.map((call) => call.method);
}

describe("upload size integrity", () => {
	it("rejects a single PUT whose stream yields fewer bytes than declared, before presigning", async () => {
		const { fetch, calls } = routedFetch(() => json(201, {}));

		const error = await clientWith(fetch)
			.uploads.upload(Readable.from([Buffer.from("abc")]), { filename: "a.bin", sizeBytes: 5 })
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(UploadError);
		expect(error).toMatchObject({ code: "size_mismatch" });
		expect(calls).toHaveLength(0);
	});

	it("rejects a multipart stream whose byte count differs from the declared size, and aborts the upload", async () => {
		const { fetch, calls } = multipartFetch(4, 3);

		const error = await clientWith(fetch)
			.uploads.upload(Readable.from([Buffer.from("0123"), Buffer.from("456789")]), {
				filename: "a.bin",
				sizeBytes: 12,
				multipartThresholdBytes: 4
			})
			.catch((err: unknown) => err);

		expect(error).toMatchObject({ code: "size_mismatch" });
		expect(methodsOf(calls).at(-1)).toBe("DELETE");
		expect(methodsOf(calls).filter((method) => method === "PUT")).toHaveLength(3);
	});

	it("aborts a multipart upload once the source stream fails, after the running parts settle", async () => {
		const { fetch, calls } = multipartFetch(4, 3);
		const failing = new Readable({
			read() {
				this.push(Buffer.from("0123"));
				this.destroy(new Error("disk gone"));
			}
		});

		const error = await clientWith(fetch)
			.uploads.upload(failing, { filename: "a.bin", sizeBytes: 12, multipartThresholdBytes: 4 })
			.catch((err: unknown) => err);

		expect(error).toMatchObject({ message: "disk gone" });
		expect(methodsOf(calls).at(-1)).toBe("DELETE");
	});
});

describe("caller cancellation", () => {
	it("passes an already aborted signal to presign and does not send the request", async () => {
		const { fetch, calls } = routedFetch(() => json(201, {}));
		const controller = new AbortController();
		controller.abort();

		await expect(
			clientWith(fetch).uploads.presign({ filename: "a.bin", sizeBytes: 1 }, { signal: controller.signal })
		).rejects.toBeInstanceOf(AbortedError);
		expect(calls).toHaveLength(0);
	});
});

describe("forEachBounded failure handling", () => {
	it("waits for running items before rethrowing a source failure", async () => {
		const finished: number[] = [];
		async function* items(): AsyncGenerator<number> {
			yield 1;
			yield 2;
			throw new Error("source failed");
		}

		await expect(
			forEachBounded(items(), 2, async (item) => {
				await new Promise((resolve) => setTimeout(resolve, 20));
				finished.push(item);
			})
		).rejects.toThrow("source failed");

		expect(finished.sort()).toEqual([1, 2]);
	});
});

describe("webhook signature header", () => {
	const SECRET = "whsec_header";
	const BODY = JSON.stringify({
		id: "e1",
		event: "helios.test",
		createdAt: "2026-10-19T00:00:00.000Z",
		sequence: 0,
		data: { accountId: "a" }
	});
	const webhooks = new Webhooks(SECRET);

	function header(digest: string, timestamp = Math.floor(Date.now() / 1000)): string {
		return `t=${timestamp},v1=${digest}`;
	}

	it.each([
		["upper-case hex", (value: string) => value.toUpperCase()],
		["leading whitespace", (value: string) => ` ${value}`],
		["trailing whitespace", (value: string) => `${value} `],
		["a space after the comma", (value: string) => value.replace(",", ", ")]
	])("rejects a header with %s as malformed, as the core signer does", (_name, mangle) => {
		const valid = header("0".repeat(64));

		expect(() => webhooks.verify(BODY, mangle(valid))).toThrow(WebhookError);
		expect(() => webhooks.verify(BODY, mangle(valid))).toThrow(
			expect.objectContaining({ code: "signature_malformed" })
		);
	});

	it("rejects an unknown event type as payload_invalid", () => {
		const unknown = JSON.stringify({
			id: "e2",
			event: "request.exploded",
			createdAt: "2026-10-19T00:00:00.000Z",
			sequence: 1,
			data: {}
		});
		const timestamp = Math.floor(Date.now() / 1000);
		const digest = createHmac("sha256", SECRET).update(`${timestamp}.${unknown}`).digest("hex");

		expect(() => webhooks.verify(unknown, header(digest, timestamp))).toThrow(
			expect.objectContaining({ code: "payload_invalid" })
		);
	});
});
