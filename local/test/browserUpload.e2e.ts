import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import {
	accounts,
	apiKeys,
	closeDb,
	createApiKey,
	ensureIndexes,
	genericPreset,
	initDb,
	mediaAssets,
	objectStore,
	requests,
	seedSystemPreset
} from "@helios/core";
import { uploadParts, type CompletedPart, type MultipartUpload, type PartUrl } from "../../sdk/src/browser/index";
import { createApp } from "../../api/src/app";
import { bootstrap } from "../bootstrap";
import { FIXTURE_DIR, generateFixtures } from "../fixtures";
import { loadLocalConfig } from "../loadConfig";
import { drainUntilTerminal } from "./drain";
import { FetchXhr } from "./fetchXhr";

const local = loadLocalConfig();
const MiB = 1024 * 1024;
const FILE_BYTES = 12 * MiB;
const FIXTURE = "h300.mp4";
const [ORIGIN] = local.uploadAllowedOrigins;
const POST_PROCESS_OFF = { transcribe: false, sceneDetection: false } as const;
const TEST_TIMEOUT_MS = 200000;
const slug = `e2e-browser-${randomUUID().slice(0, 8)}`;
const globals = globalThis as unknown as { XMLHttpRequest?: unknown };
const realXhr = globals.XMLHttpRequest;

let server: Server | undefined;
let base = "";
let adminKey = "";
let accountId = "";
let accountKey = "";
let file: Buffer;
let upload: MultipartUpload;
let firstPartEtag = "";

async function call(method: string, urlPath: string, key: string, body?: unknown) {
	const res = await fetch(`${base}${urlPath}`, {
		method,
		headers: {
			authorization: `Bearer ${key}`,
			...(body !== undefined && { "content-type": "application/json" })
		},
		...(body !== undefined && { body: JSON.stringify(body) })
	});
	const text = await res.text();
	return { status: res.status, body: text.length > 0 ? (JSON.parse(text) as Record<string, any>) : undefined };
}

const account = (method: string, urlPath: string, body?: unknown) => call(method, urlPath, accountKey, body);

function signParts(partNumbers: number[]): Promise<PartUrl[]> {
	return account("POST", `/uploads/multipart/${upload.uploadId}/parts`, {
		uploadKey: upload.uploadKey,
		partNumbers
	}).then((res) => res.body?.parts);
}

function withFreePadding(bytes: Buffer, totalSize: number): Buffer {
	const header = Buffer.alloc(8);
	header.writeUInt32BE(totalSize - bytes.length, 0);
	header.write("free", 4);
	return Buffer.concat([bytes, header, Buffer.alloc(totalSize - bytes.length - header.length)]);
}

beforeAll(async () => {
	generateFixtures();
	file = withFreePadding(fs.readFileSync(path.join(FIXTURE_DIR, FIXTURE)), FILE_BYTES);
	await bootstrap(local.e2eQueuePrefix, [local.mediaBucket, local.sourceBucket], local.worker.visibilityExtensionSec);
	await initDb(local.mongoUri);
	await ensureIndexes();
	await seedSystemPreset(genericPreset);
	adminKey = (await createApiKey({ scope: "admin", name: `e2e-${slug}` })).key;
	server = createApp().listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	const created = await call("POST", "/admin/accounts", adminKey, {
		slug,
		name: "E2E browser upload",
		sourceBuckets: [local.sourceBucket],
		features: { peopleAttributes: false }
	});
	accountId = created.body?.id;
	accountKey = (await call("POST", `/admin/accounts/${accountId}/keys`, adminKey, { name: "e2e" })).body?.key;
	globals.XMLHttpRequest = FetchXhr;
});

afterAll(async () => {
	globals.XMLHttpRequest = realXhr;
	FetchXhr.interceptor = undefined;
	await new Promise<void>((resolve) => {
		if (server === undefined) {
			resolve();
			return;
		}
		server.closeAllConnections();
		server.close(() => resolve());
	});
	await Promise.all([
		accounts().deleteMany({ _id: accountId }),
		apiKeys().deleteMany({ accountId }),
		mediaAssets().deleteMany({ accountId }),
		requests().deleteMany({ accountId })
	]);
	await objectStore().deleteKeys(await objectStore().listKeys(`${slug}/`));
	await closeDb();
});

describe("browser multipart upload against LocalStack", () => {
	it("creates a multipart upload with 5 MiB parts and lets the dev origin preflight PUT", async () => {
		const res = await account("POST", "/uploads/multipart", {
			filename: FIXTURE,
			sizeBytes: FILE_BYTES,
			contentType: "video/mp4"
		});
		upload = res.body as MultipartUpload;
		const preflight = await fetch(upload.parts[0].url, {
			method: "OPTIONS",
			headers: {
				origin: ORIGIN,
				"access-control-request-method": "PUT",
				"access-control-request-headers": "content-type"
			}
		});

		expect(res.status).toBe(201);
		expect(upload.partSizeBytes).toBe(5 * MiB);
		expect(upload.parts).toHaveLength(3);
		expect(preflight.status).toBe(200);
		expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
		expect(preflight.headers.get("access-control-allow-methods")).toContain("PUT");
	});

	it("exposes the ETag of a part to the origin, then stores the first part", async () => {
		const put = await fetch(upload.parts[0].url, {
			method: "PUT",
			body: file.subarray(0, 5 * MiB),
			headers: { origin: ORIGIN }
		});
		firstPartEtag = put.headers.get("etag") ?? "";

		expect(put.status).toBe(200);
		expect(put.headers.get("access-control-expose-headers")).toMatch(/etag/i);
		expect(firstPartEtag).not.toBe("");
	});

	it(
		"resumes from listParts, re-signs an expired part, and completes the upload without encoding",
		async () => {
			const listed = await account(
				"GET",
				`/uploads/multipart/${upload.uploadId}/parts?uploadKey=${encodeURIComponent(upload.uploadKey)}`
			);
			const expiredUrl = upload.parts[2].url;
			let expired = false;
			FetchXhr.interceptor = (url) => {
				if (url !== expiredUrl || expired) {
					return undefined;
				}
				expired = true;
				return new Response("<Error>AccessDenied</Error>", { status: 403 });
			};
			const reSigned: number[] = [];
			const progress: number[] = [];

			const completed: CompletedPart[] = await uploadParts(upload, new Blob([file]), {
				concurrency: 2,
				uploadedParts: listed.body?.parts,
				signParts: async (partNumbers) => {
					reSigned.push(...partNumbers);
					return signParts(partNumbers);
				},
				onProgress: ({ uploadedBytes }) => progress.push(uploadedBytes)
			});
			FetchXhr.interceptor = undefined;
			const done = await account("POST", `/uploads/multipart/${upload.uploadId}/complete`, {
				uploadKey: upload.uploadKey,
				parts: completed
			});

			expect(listed.body?.parts).toEqual([{ partNumber: 1, etag: firstPartEtag, sizeBytes: 5 * MiB }]);
			expect(reSigned).toEqual([3]);
			expect(completed.map((part) => part.partNumber)).toEqual([1, 2, 3]);
			expect(completed[0].etag).toBe(firstPartEtag);
			expect(progress.at(-1)).toBe(FILE_BYTES);
			expect(done.status).toBe(200);
			expect(done.body).toEqual({ uploadKey: upload.uploadKey });
		},
		TEST_TIMEOUT_MS
	);

	it(
		"encodes the completed upload later by its uploadKey",
		async () => {
			const encoded = await account("POST", "/encode", {
				source: { uploadKey: upload.uploadKey },
				preset: "generic",
				postProcess: POST_PROCESS_OFF,
				analyze: "sync"
			});
			const requestId: string = encoded.body?.id;
			await drainUntilTerminal([requestId]);

			expect(encoded.status).toBe(201);
			expect((await requests().findOne({ _id: requestId }))?.status).toBe("COMPLETE");
		},
		TEST_TIMEOUT_MS
	);
});
