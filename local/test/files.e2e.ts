import fs from "node:fs";
import path from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
	accounts,
	apiKeys,
	cdnInvalidations,
	closeDb,
	createAccount,
	createApiKey,
	ensureIndexes,
	files,
	genericPreset,
	initDb,
	objectStore,
	requests,
	seedSystemPreset,
	type Account
} from "@helios/core";
import { Helios, NotFoundError, UploadCompleteError, type FileView } from "../../sdk/src/index";
import { dimensionsOf } from "../../functions/test/helpers/images";
import { createApp } from "../../api/src/app";
import { bootstrap } from "../bootstrap";
import { FIXTURE_DIR, generateFixtures } from "../fixtures";
import { loadLocalConfig } from "../loadConfig";
import { startImageEdge, type ImageEdge } from "../imageEdge";
import { runLambdaSources } from "../lambdaRunner";
import { startWebhookSink, type WebhookSink } from "../webhookSink";
import { drainUntilTerminal } from "./drain";

const local = loadLocalConfig();
const TEST_TIMEOUT_MS = 240000;
const slug = `files-e2e-${randomUUID().slice(0, 8)}`;
const OPEN_POLICY = { allowedContentTypes: ["*/*"], maxBytes: local.maxUploadBytes };
const IMAGE_POLICY = { allowedContentTypes: ["image/*"], maxBytes: local.maxUploadBytes };

let server: Server;
let sourceServer: Server;
let edge: ImageEdge;
let sink: WebhookSink;
let account: Account;
let helios: Helios;
let base = "";
let sourceBase = "";
let stored: FileView;
let runner: AbortController;
let running: Promise<void>;

function readFixture(name: string): Buffer {
	return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, deadlineMs = 120000): Promise<T> {
	const deadline = Date.now() + deadlineMs;
	let value = await read();
	while (!done(value) && Date.now() < deadline) {
		await sleep(500);
		value = await read();
	}
	return value;
}

beforeAll(async () => {
	generateFixtures();
	await bootstrap(local.e2eQueuePrefix, [local.mediaBucket, local.sourceBucket], local.lambdas.e2eVisibilityTimeoutSec);
	await initDb(local.mongoUri);
	await ensureIndexes();
	await seedSystemPreset(genericPreset);
	sink = await startWebhookSink({ secret: () => account.webhookSecret });
	account = await createAccount({
		slug,
		name: "E2E files",
		sourceBuckets: [local.sourceBucket],
		features: { peopleAttributes: false },
		destination: { type: "webhook", url: sink.url }
	});
	const { key } = await createApiKey({ scope: "account", accountId: account._id, name: "e2e" });
	server = createApp().listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server.once("listening", () => resolve()));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const image = readFixture("image.png");
	sourceServer = createServer((req, res) => {
		if (req.url === "/logo.png") {
			res.writeHead(200, { "content-type": "image/png" }).end(image);
		} else if (req.url === "/notes.png") {
			res.writeHead(200, { "content-type": "image/png" }).end("these notes are text, not a png");
		} else {
			res.writeHead(404).end();
		}
	});
	await new Promise<void>((resolve) => sourceServer.listen(0, "127.0.0.1", () => resolve()));
	sourceBase = `http://127.0.0.1:${(sourceServer.address() as AddressInfo).port}`;
	edge = await startImageEdge(0);
	helios = new Helios({ apiKey: key, baseUrl: base, imageBaseUrl: edge.url });
	runner = new AbortController();
	running = runLambdaSources({ signal: runner.signal });
}, 180000);

afterAll(async () => {
	runner?.abort();
	await running?.catch(() => undefined);
	await edge?.close();
	await sink?.close();
	server?.closeAllConnections();
	sourceServer?.closeAllConnections();
	await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
	await new Promise<void>((resolve) => sourceServer?.close(() => resolve()) ?? resolve());
	await Promise.all([
		accounts().deleteMany({ _id: account?._id }),
		apiKeys().deleteMany({ accountId: account?._id }),
		files().deleteMany({ accountId: account?._id })
	]);
	await objectStore().deleteKeys(await objectStore().listKeys(`${slug}/`));
	await closeDb();
}, 120000);

describe("helios as a file store against LocalStack and Mongo", () => {
	it("stores an image server-side and returns its CDN url and dimensions", async () => {
		const bytes = readFixture("image.png");

		const { file } = await helios.uploads.upload(bytes, {
			filename: "logo.png",
			contentType: "image/png",
			externalId: "logo-1",
			store: true
		});
		stored = file;

		expect(file).toMatchObject({
			status: "STORED",
			contentType: "image/png",
			sizeBytes: bytes.length,
			image: { width: 1600, height: 900, format: "png" },
			externalId: "logo-1"
		});
		expect(file.url).toMatch(new RegExp(`/${file.key}\\?v=\\d+$`));
	});

	it("serves a resized transform of the stored image through the local edge", async () => {
		const response = await fetch(helios.images.url(stored.key, { w: 320, h: 180 }));

		expect(response.status).toBe(200);
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("content-security-policy")).toContain("sandbox");
		expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
		expect(await dimensionsOf(Buffer.from(await response.arrayBuffer()))).toEqual({ width: 320, height: 180 });
	});

	it(
		"encodes a stored video later, by its fileId, to completion",
		async () => {
			const video = readFixture("h300.mp4");
			const { file } = await helios.uploads.upload(video, {
				filename: "h300.mp4",
				contentType: "video/mp4",
				store: true
			});

			const created = await helios.encodes.create({
				source: { fileId: file.id },
				preset: "generic",
				postProcess: { transcribe: false, sceneDetection: false },
				analyze: "sync"
			});
			await drainUntilTerminal([created.id]);

			expect(created.mode).toBe("encode");
			expect((await requests().findOne({ _id: created.id }))?.status).toBe("COMPLETE");
		},
		TEST_TIMEOUT_MS
	);

	it("deletes the file: it is gone from the API and the edge, and the CDN invalidation is recorded", async () => {
		await expect(helios.files.delete(stored.id)).resolves.toEqual({ fileId: stored.id });

		await expect(helios.files.get(stored.id)).rejects.toBeInstanceOf(NotFoundError);
		expect((await fetch(helios.images.url(stored.key, { w: 320 }))).status).toBe(404);
		expect(await cdnInvalidations().findOne({ _id: `file-delete:${stored.id}` })).toMatchObject({
			paths: [`/${stored.key.slice(0, stored.key.lastIndexOf("/"))}/*`]
		});
	});

	it(
		"stores a file fetched from a URL, and reports file.stored to the webhook",
		async () => {
			const pending = await helios.files.fromUrl({ url: `${sourceBase}/logo.png`, externalId: "from-url-1" });
			expect(pending.status).toBe("PENDING");

			const done = await until(
				() => helios.files.get(pending.id),
				(file) => file.status !== "PENDING"
			);
			const event = await until(
				async () =>
					sink.events.find(
						(item) =>
							item.event === "file.stored" &&
							item.body.data &&
							(item.body.data as { file: FileView }).file.id === pending.id
					),
				(found) => found !== undefined
			);

			expect(done).toMatchObject({
				status: "STORED",
				contentType: "image/png",
				image: { width: 1600, height: 900, format: "png" }
			});
			expect(event).toMatchObject({ verified: true, status: 200 });
		},
		TEST_TIMEOUT_MS
	);

	it(
		"fails a file from a URL whose bytes are not the image it promises, and reports file.failed",
		async () => {
			await helios.account.setUploadPolicy(IMAGE_POLICY);
			const pending = await helios.files.fromUrl({ url: `${sourceBase}/notes.png` });

			const done = await until(
				() => helios.files.get(pending.id),
				(file) => file.status !== "PENDING"
			);
			const event = await until(
				async () =>
					sink.events.find(
						(item) =>
							item.event === "file.failed" && (item.body.data as { file: FileView } | undefined)?.file.id === pending.id
					),
				(found) => found !== undefined
			);

			expect(done).toMatchObject({ status: "FAILED", error: expect.stringMatching(/not allowed/) });
			expect(event).toBeDefined();
		},
		TEST_TIMEOUT_MS
	);

	it("answers 422 policy_violation when the bytes contradict the declared image type, and keeps the file FAILED", async () => {
		await helios.account.setUploadPolicy(IMAGE_POLICY);

		const attempt = helios.uploads.upload(Buffer.from("plain text under a png name"), {
			filename: "logo.png",
			contentType: "image/png",
			store: true
		});

		await expect(attempt).rejects.toBeInstanceOf(UploadCompleteError);
		await expect(attempt).rejects.toMatchObject({ code: "policy_violation", status: 422, fileId: expect.any(String) });
		const listed = await helios.files.list();
		expect(listed.files.some((file) => file.status === "FAILED" && file.filename === "logo.png")).toBe(true);
		await helios.account.setUploadPolicy(OPEN_POLICY);
	});
});
