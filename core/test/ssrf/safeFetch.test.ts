import { resetConfigForTests } from "../../src/config";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Readable } from "node:stream";
import {
	ResponseTooLargeError,
	safeFetch,
	UnprocessableSourceError,
	UnsafeUrlError,
	type ResolvedAddress
} from "../../src/ssrf";

type Route = (res: ServerResponse, port: number) => void;

const routes: Record<string, Route> = {
	"/ok": (res) => res.writeHead(200, { "content-type": "text/plain", "content-length": "11" }).end("hello world"),
	"/chunked": (res) => {
		res.writeHead(200, { "content-type": "application/octet-stream" });
		for (let i = 0; i < 10; i++) {
			res.write("x".repeat(100));
		}
		res.end();
	},
	"/declared-large": (res) => res.writeHead(200, { "content-length": "5000" }).end("x".repeat(5000)),
	"/redirect-allowed": (res, port) => redirect(res, `http://fake.test:${port}/ok`),
	"/redirect-metadata": (res) => redirect(res, "http://169.254.169.254/latest/meta-data/"),
	"/loop": (res) => redirect(res, "/loop"),
	"/missing": (res) => res.writeHead(404).end("nope"),
	"/hang": () => undefined
};

function redirect(res: ServerResponse, location: string): void {
	res.writeHead(302, { location }).end();
}

const resolve = async (hostname: string): Promise<ResolvedAddress[]> =>
	hostname === "fake.test" ? [{ address: "127.0.0.1", family: 4 }] : [];

async function readAll(body: Readable): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of body) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString();
}

describe("safeFetch", () => {
	const original = process.env;
	let server: Server;
	let port: number;
	let base: string;

	beforeAll(async () => {
		process.env = { ...original, SSRF_ALLOWED_HOSTS: "127.0.0.1,fake.test" };
		resetConfigForTests();
		server = createServer((req, res) => {
			const route = routes[req.url ?? ""];
			if (route === undefined) {
				res.writeHead(500).end();
				return;
			}
			route(res, port);
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		port = (server.address() as AddressInfo).port;
		base = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		server.closeAllConnections();
		await new Promise<void>((done) => server.close(() => done()));
		process.env = original;
		resetConfigForTests();
	});

	it("streams a successful body with its content type and length", async () => {
		const response = await safeFetch(`${base}/ok`, { maxBytes: 1024, maxRedirects: 3, resolve });
		expect(response.contentType).toBe("text/plain");
		expect(response.contentLength).toBe(11);
		await expect(readAll(response.body)).resolves.toBe("hello world");
	});

	it("errors the body stream with ResponseTooLargeError when the streamed bytes exceed maxBytes", async () => {
		const response = await safeFetch(`${base}/chunked`, { maxBytes: 500, maxRedirects: 3, resolve });
		await expect(readAll(response.body)).rejects.toBeInstanceOf(ResponseTooLargeError);
	});

	it("rejects early with ResponseTooLargeError when Content-Length exceeds maxBytes", async () => {
		await expect(
			safeFetch(`${base}/declared-large`, { maxBytes: 100, maxRedirects: 3, resolve })
		).rejects.toBeInstanceOf(ResponseTooLargeError);
	});

	it("follows a redirect to another allowed host, pinned to its validated address", async () => {
		const response = await safeFetch(`${base}/redirect-allowed`, { maxBytes: 1024, maxRedirects: 3, resolve });
		await expect(readAll(response.body)).resolves.toBe("hello world");
	});

	it("rejects a redirect to the cloud metadata address with UnsafeUrlError", async () => {
		await expect(
			safeFetch(`${base}/redirect-metadata`, { maxBytes: 1024, maxRedirects: 3, resolve })
		).rejects.toBeInstanceOf(UnsafeUrlError);
	});

	it("rejects a redirect loop that exceeds maxRedirects", async () => {
		await expect(safeFetch(`${base}/loop`, { maxBytes: 1024, maxRedirects: 2, resolve })).rejects.toThrow(
			"Too many redirects"
		);
	});

	it("rejects a non-2xx final status as UnprocessableSourceError with the status code", async () => {
		await expect(safeFetch(`${base}/missing`, { maxBytes: 1024, maxRedirects: 3, resolve })).rejects.toMatchObject({
			code: "unprocessable_source",
			httpStatus: 422,
			message: expect.stringContaining("404")
		});
	});

	it("maps a refused connection to UnprocessableSourceError", async () => {
		await expect(
			safeFetch("http://127.0.0.1:1/file", { maxBytes: 1024, maxRedirects: 3, resolve })
		).rejects.toBeInstanceOf(UnprocessableSourceError);
	});

	it("times out a server that never responds after INGEST_TIMEOUT_SEC", async () => {
		process.env.INGEST_TIMEOUT_SEC = "1";
		resetConfigForTests();
		try {
			await expect(safeFetch(`${base}/hang`, { maxBytes: 1024, maxRedirects: 3, resolve })).rejects.toThrow(
				UnprocessableSourceError
			);
		} finally {
			process.env.INGEST_TIMEOUT_SEC = original.INGEST_TIMEOUT_SEC;
			resetConfigForTests();
		}
	}, 15000);
});
