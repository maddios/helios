import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { objectStore } from "@helios/core";
import { noisePng, dimensionsOf } from "../../functions/test/helpers/images";
import { FIXTURE_DIR, generateFixtures } from "../fixtures";
import { startImageEdge, type ImageEdge } from "../imageEdge";

const suffix = randomUUID().slice(0, 8);
const slug = `img-e2e-${suffix}`;
const assetPrefix = `${slug}/media/a${suffix}`;
const PNG_KEY = `${assetPrefix}/image.png`;
const STILL_KEY = `${assetPrefix}/stills/still_0001.jpg`;
const BIG_KEY = `${assetPrefix}/big.png`;
const SOURCE_KEY = `${slug}/sources/a${suffix}/original`;

let edge: ImageEdge;

function firstFrameJpeg(): Buffer {
	const result = spawnSync(
		"ffmpeg",
		[
			"-loglevel",
			"error",
			"-i",
			path.join(FIXTURE_DIR, "h300.mp4"),
			"-frames:v",
			"1",
			"-f",
			"image2pipe",
			"-c:v",
			"mjpeg",
			"pipe:1"
		],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
	if (result.status !== 0) {
		throw new Error(`ffmpeg failed extracting a still: ${result.stderr.toString()}`);
	}
	return result.stdout;
}

beforeAll(async () => {
	generateFixtures();
	const store = objectStore();
	await store.uploadFile(PNG_KEY, path.join(FIXTURE_DIR, "image.png"), "image/png");
	await store.uploadBuffer(STILL_KEY, firstFrameJpeg(), "image/jpeg", "no-store");
	await store.uploadBuffer(BIG_KEY, await noisePng(4096, 4096), "image/png", "no-store");
	await store.uploadBuffer(SOURCE_KEY, Buffer.from("source"), "application/octet-stream", "no-store");
	edge = await startImageEdge(0);
}, 180000);

afterAll(async () => {
	await edge?.close();
	const store = objectStore();
	await store.deleteKeys([...(await store.listKeys(`${slug}/`)), ...(await store.listKeys(`resize_cache/${slug}/`))]);
});

describe("local image edge", () => {
	it("serves a cropped still as jpeg and serves the second request from resize_cache", async () => {
		const url = `${edge.url}/img/w_320,h_180,c_fill/${STILL_KEY}`;
		const before = edge.stats.handlerInvocations;

		const first = await fetch(url);
		expect(first.status).toBe(200);
		expect(first.headers.get("content-type")).toBe("image/jpeg");
		expect(await dimensionsOf(Buffer.from(await first.arrayBuffer()))).toEqual({ width: 320, height: 180 });
		expect(edge.stats.handlerInvocations).toBe(before + 1);

		const second = await fetch(url);
		expect(second.status).toBe(200);
		expect(second.headers.get("content-type")).toBe("image/jpeg");
		expect(await dimensionsOf(Buffer.from(await second.arrayBuffer()))).toEqual({ width: 320, height: 180 });
		expect(edge.stats.handlerInvocations).toBe(before + 1);
	});

	it("encodes the png fixture to webp", async () => {
		const response = await fetch(`${edge.url}/img/w_200,f_webp,q_80/${PNG_KEY}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/webp");
	});

	it("redirects non-canonical parameter order to the canonical url and keeps v", async () => {
		const response = await fetch(`${edge.url}/img/h_180,w_320,c_fill/${STILL_KEY}?v=3`, { redirect: "manual" });
		expect(response.status).toBe(301);
		expect(response.headers.get("location")).toBe(`/img/w_320,h_180,c_fill/${STILL_KEY}?v=3`);
	});

	it("rejects a key under sources/ with 400", async () => {
		const response = await fetch(`${edge.url}/img/w_320/${SOURCE_KEY}`);
		expect(response.status).toBe(400);
	});

	it("returns 404 for a missing original", async () => {
		const response = await fetch(`${edge.url}/img/w_320/${assetPrefix}/missing.png`);
		expect(response.status).toBe(404);
	});

	it("returns the 302 for a variant over 6 MB, and following it serves the cached bytes", async () => {
		const before = edge.stats.handlerInvocations;
		const redirect = await fetch(`${edge.url}/img/w_4096,f_png/${BIG_KEY}`, { redirect: "manual" });
		expect(redirect.status).toBe(302);
		expect(redirect.headers.get("cache-control")).toBe("no-store");
		const location = redirect.headers.get("location");
		expect(location).toBe(`/img/w_4096,f_png/${BIG_KEY}`);

		const response = await fetch(`${edge.url}${location}`);
		expect(response.status).toBe(200);
		expect(await dimensionsOf(Buffer.from(await response.arrayBuffer()))).toEqual({ width: 4096, height: 4096 });
		expect(edge.stats.handlerInvocations).toBe(before + 1);
	}, 120000);
});
