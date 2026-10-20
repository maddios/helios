# @partnrup/helios-sdk

Helios is a standalone encoding and AI post-processing service. You give it a media file, either an object in an S3 bucket the account is allowed to read, a file uploaded through the SDK, or a public URL, and name a preset. Helios encodes the renditions the preset describes, extracts stills and audio, and can transcribe speech, translate the transcript and detect scenes. Each request reports its progress as signed webhook events or EventBridge events, so your application does not poll the pipeline. Bella is the first account on Helios, and novel follows.

This package is the typed Node.js client for the Helios API. It runs on the server only, because it carries an account API key. Every request and response is typed from the zod schemas the API validates with, and every failure is a `HeliosError` with a machine-readable `code`, the HTTP `status` and the `requestId` for support requests.

## Install

```bash
npm install @partnrup/helios-sdk
```

Requires Node.js 18.17 or later. The package is published with restricted access, so npm must be logged in with an account that can read the `@partnrup` scope. Account-scoped integrations import the client from `@partnrup/helios-sdk`; operator tasks import `@partnrup/helios-sdk/admin`.

## Quickstart

Create a client, upload a file and encode it in one call, then wait for the encode to finish.

```ts
import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const { file, request } = await helios.uploads.upload(requireEnv("MEDIA_PATH"), {
	contentType: "video/mp4",
	encode: { preset: "generic" },
	onProgress: ({ uploadedBytes, totalBytes }) => console.log(`uploaded ${uploadedBytes} of ${totalBytes} bytes`)
});

const done = await helios.requests.wait(request!.id, { timeoutMs: 10 * 60_000 });
if (done.status === "ERROR") {
	throw new Error(`Encode failed (${done.error?.code}): ${done.error?.message}`);
}

console.log(file.id, request!.assetId, done.status);
```

Helios signs every webhook with the account's webhook secret. Verify the raw request body before you parse it. The route must use `express.raw`, because a global JSON parser would consume the body first.

```ts
import express from "express";
import { Helios, WebhookError, type WebhookEvent } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL"),
	webhookSecret: requireEnv("HELIOS_WEBHOOK_SECRET")
});

const processed = new Set<string>();

const app = express();

app.post("/helios/webhooks", express.raw({ type: "application/json" }), (req, res) => {
	let event: WebhookEvent;
	try {
		event = helios.webhooks.verify(req.body, req.get("Helios-Signature"));
	} catch (err) {
		if (err instanceof WebhookError) {
			res.sendStatus(400);
			return;
		}
		throw err;
	}

	if (!processed.has(event.id)) {
		if (event.event === "request.completed") {
			console.log("ready", event.data.asset.id, event.data.request.status);
		}
		if (event.event === "item.failed") {
			console.error("item failed", event.data.item.key, event.data.item.error);
		}
		processed.add(event.id);
	}

	res.sendStatus(204);
});

app.listen(Number(requireEnv("PORT")));
```

For the complete reference, read [AGENTS.md](./AGENTS.md) (a dense method index, the event catalogue and the integration checklists), the [webhook guide](./guides/webhooks.md) and the [EventBridge guide](./guides/eventbridge.md). Generated TypeDoc output is written to `sdk/docs/` by `npm run docs -w sdk`.

## Recipes

### Encode an object from a source bucket

The bucket must be allowed for the account, and Helios must have read access to it. Helios never deletes or changes objects in a source bucket. Analysis is asynchronous by default, so the call returns `202` with the request, and you wait for it or receive the `request.completed` event.

```ts
const body: EncodeRequest = {
	source: { bucket: requireEnv("KODAK_SOURCE_BUCKET"), key: requireEnv("KODAK_SOURCE_KEY") },
	preset: "generic",
	externalId: "bella-clip-42",
	postProcess: { transcribe: { translations: ["es"] }, sceneDetection: true },
	analyze: "async"
};
```

### Sync or async analysis

`analyze` decides when Helios probes the source. `"async"`, the default, accepts the request with `202` and probes on the queue. `"sync"` probes before the call returns, and the call returns `201`. The line below is a dry run, so it creates nothing and returns the planned items.

```ts
const plan = await helios.encodes.create({ ...body, analyze: "sync" }, { dryRun: true });
```

### Add translations after the encode

Post-processing on an existing asset is additive. Stored languages are kept, missing ones are added, and the native transcript is reused, so no audio is transcribed again. Up to 20 target languages are allowed per request, duplicates are ignored, and unknown codes return `400` with all of them listed. Pass `retranscribe: true` to transcribe the audio again.

```ts
const accepted = await helios.assets.postProcess(assetId, {
	postProcess: { transcribe: { translations: ["es", "fr"] } }
});
```

### Read transcripts

Each transcript has its language, whether it is a translation, its timed segments, its full text and CDN urls for the SRT, WebVTT and plain-text files.

```ts
const { transcripts } = await helios.assets.transcripts(assetId);
```

### Scenes and representative stills

`assets.scenes` returns a summary of the asset and the detected scenes. Each scene names its representative still by `index` into the asset's `stills` output. The call returns `409` until scene detection has completed.

```ts
const { scenes, summary } = await helios.assets.scenes(assetId);

const stills = asset.outputs.stills?.items ?? [];
const scene = scenes[0];
const still = stills[scene.representativeStill.index];
if (still === undefined) {
	throw new Error(`Scene ${scene.sceneNumber} has no still`);
}

const cover = helios.images.url(still.key, { w: 320, h: 180, c: "fill", g: "center", f: "webp", q: 85 }, asset.version);
const thumb = helios.images.url(still.key, { w: 160, q: 80 });
```

### Image URLs

`images.url` builds the canonical URL of a transformed media or file key. The same image always gets the same URL, so the CDN caches it once. Pass the asset `version` as the cache-buster. The builder supports `w`, `h`, `c` (`fit` default, `fill`, `limit`, `pad`), `g` (gravity, with `fill`), `b` (pad colour, with `pad`), `q` and `f` (`jpg`, `png`, `webp` or `avif`). JPG output pads and flattens onto white unless `b` is set. Source and upload keys are rejected. It needs `imageBaseUrl` on the client.

```ts
const cover = helios.images.url(still.key, { w: 320, h: 180, c: "fill", g: "center", f: "webp", q: 85 }, asset.version);
const thumb = helios.images.url(still.key, { w: 160, q: 80 });
```

### Customize a preset

Presets are versioned. Clone a system preset into an account preset, add profiles and change them with `expectedVersion`, the version you last read. A stale version returns `409` with `preset_version_conflict`, so re-read the preset and apply the change again. An asset keeps the preset snapshot it was encoded with until you re-encode it with `refreshPreset`.

```ts
import { ConflictError, Helios, type PresetView, type ProfileInput } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

async function ensureBellaPreset(): Promise<PresetView> {
	try {
		return await helios.presets.clone("generic", "bella");
	} catch (err) {
		if (err instanceof ConflictError) {
			return helios.presets.get("bella");
		}
		throw err;
	}
}

const thumbnail: ProfileInput = {
	type: "image",
	name: "thumb_webp",
	priority: 20,
	isDefault: false,
	sourceTypes: ["video"],
	children: [],
	output: "thumb.webp",
	params: { format: "webp", quality: 80 }
};

let preset = await ensureBellaPreset();

try {
	preset = await helios.presets.addProfile("bella", { expectedVersion: preset.version, profile: thumbnail });
} catch (err) {
	if (!(err instanceof ConflictError)) {
		throw err;
	}
	preset = await helios.presets.get("bella");
	console.log(`bella changed to version ${preset.version}; re-apply the change to it`);
}

preset = await helios.presets.updateProfile("bella", "thumb_webp", {
	expectedVersion: preset.version,
	priority: 5
});

console.log(
	preset.name,
	preset.version,
	preset.profiles.map((profile) => profile.name)
);
```

### Re-encode with the latest preset

A re-encode bumps the asset version and writes its outputs in place. Pass `refreshPreset: true` to re-resolve the preset first. A `409` means the asset already has a pending request.

```ts
const request = await helios.encodes.reencode(requireEnv("ASSET_ID"), { refreshPreset: true });
const done = await helios.requests.wait(request.id);
```

### Cancel a request

Cancelling stops pending items. Work that is already running may still finish. A request that has already finished returns `409`.

```ts
import { ConflictError, Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

try {
	const cancelled = await helios.requests.cancel(requireEnv("REQUEST_ID"));
	console.log(cancelled.status);
} catch (err) {
	if (err instanceof ConflictError) {
		console.log("the request already finished");
	} else {
		throw err;
	}
}
```

### Purge an asset (right to be forgotten)

`assets.delete` accepts the purge with `202`. The outputs and the copies Helios holds are removed asynchronously, and an `asset.deleted` event follows. Source objects in your own buckets remain your responsibility. Usage records are kept, because they hold units and not content.

```ts
import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const externalId = requireEnv("EXTERNAL_ID");

let cursor: string | undefined;
do {
	const page = await helios.assets.list({ externalId, cursor });
	for (const asset of page.assets) {
		const accepted = await helios.assets.delete(asset.id);
		console.log("purge accepted", accepted.assetId);
	}
	cursor = page.nextCursor;
} while (cursor !== undefined);
```

### Destinations: webhook or EventBridge

The account default is set with `account.setDestination`. A request can name its own `destination`, or the `callbackUrl` shorthand for a webhook. `destinations.test` sends a `helios.test` event so you can check your endpoint or bus before you rely on it. EventBridge buses need a resource policy first, and the [EventBridge guide](./guides/eventbridge.md) walks through it.

```ts
import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const eventBusArn = requireEnv("EVENT_BUS_ARN");

const { policy, command } = await helios.destinations.eventBridgePolicy(eventBusArn);
console.log(command, policy);

const test = await helios.destinations.test({ type: "eventbridge", eventBusArn });
if (!test.ok) {
	throw new Error(`${test.error?.code}: ${test.error?.hint}`);
}

await helios.account.setDestination({ type: "eventbridge", eventBusArn });
```

### Usage units

`usage.get` returns the totals and one entry per day. Units are resource quantities, not prices: Lambda GB-seconds, Fargate vCPU and GB seconds (on-demand and spot), output GB, transcribed audio seconds and LLM tokens per model. Helios stores no currency, so apply your own rates.

```ts
import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const usage = await helios.usage.get({ from: requireEnv("USAGE_FROM"), to: requireEnv("USAGE_TO") });

console.log(usage.requests, usage.units.lambdaGbSeconds, usage.units.outputGb);
for (const day of usage.days) {
	console.log(day.date, day.requests, day.units.transcriptionAudioSeconds);
}
```

### Store a file

`uploads.upload` stores a file and keeps it, with no encode. Small files go in one PUT and large files in parts; the SDK follows the server's choice. The stored file has a CDN `url`, and image files also report their dimensions. `images.url` builds a transformed URL for any image file key.

```ts
import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL"),
	imageBaseUrl: requireEnv("HELIOS_IMAGE_BASE_URL")
});

const { file } = await helios.uploads.upload(requireEnv("MEDIA_PATH"), {
	contentType: "image/png",
	externalId: "logo-42",
	store: true
});

const thumbnail = helios.images.url(file.key, { w: 320, h: 180 });
console.log(file.id, file.url, file.image, thumbnail);
```

### Encode a stored file later

A stored file can be encoded any time, as many times as you like. The encode reads the stored file in place, and the file itself is kept.

```ts
import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const request = await helios.encodes.create({
	source: { fileId: requireEnv("FILE_ID") },
	preset: "generic"
});

const done = await helios.requests.wait(request.id, { timeoutMs: 10 * 60_000 });
console.log(request.assetId, done.status);
```

### Store a file from a URL

`files.fromUrl` makes Helios fetch a public URL. The file is `PENDING` until the fetch finishes, then `STORED` or `FAILED`. The webhook receives `file.stored` or `file.failed`, and the fetch uses the same SSRF guard as encodes from a URL.

```ts
import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const pending = await helios.files.fromUrl({ url: "https://example.com/logo.png", externalId: "logo-42" });

let file = pending;
while (file.status === "PENDING") {
	await new Promise((resolve) => setTimeout(resolve, 2_000));
	file = await helios.files.get(pending.id);
}

console.log(file.status, file.url, file.error);
```

### Delete a file

`files.delete` removes the object, its cached image variants and its CDN copies, and answers 200 with `{ fileId }`. The file answers 404 from the API straight away. While a request that has not finished reads the file, the call answers 409 `file_in_use`.

```ts
import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

await helios.files.delete(requireEnv("FILE_ID"));
console.log("deleted; its CDN copies are invalidated");
```

### Upload policy

The account upload policy limits the content types and the size of its uploads. A request may narrow the policy for one upload but never widen it. Storage checks the bytes too: a file whose content does not match its declared image or video type is rejected with a 422 `policy_violation`.

```ts
import { Helios, UnprocessableError } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

await helios.account.setUploadPolicy({ allowedContentTypes: ["image/*", "video/mp4"], maxBytes: 5 * 1024 ** 3 });

try {
	await helios.uploads.upload(requireEnv("MEDIA_PATH"), {
		contentType: "image/png",
		policy: { allowedContentTypes: ["image/png"], maxBytes: 10 * 1024 ** 2 },
		store: true
	});
} catch (err) {
	if (err instanceof UnprocessableError) {
		console.log("rejected by policy:", err.code, err.message);
	} else {
		throw err;
	}
}
```

### Browser uploads (backend + browser)

Large files go from the browser straight to storage, so the file never passes through your backend. The backend keeps the secret key. It creates the multipart upload, re-signs parts whose URLs expired, lists the parts storage already holds so an interrupted upload can resume, and completes the upload. The page uses `@partnrup/helios-sdk/browser`, which holds no key and reports progress through XHR.

The backend handles five routes: start (`startBrowserUpload`), stored parts (`storedBrowserParts`), renew (`renewBrowserParts`), finish (`finishBrowserUpload`, which stores the file, or `finishBrowserUploadAndEncode`, which also encodes it) and abandon (`abandonBrowserUpload`). Protect these routes as you protect the rest of your API. The example leaves that to your app.

```ts
import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

export async function startBrowserUpload(filename: string, sizeBytes: number) {
	return helios.uploads.create({ filename, sizeBytes, contentType: "video/mp4" });
}

export async function renewBrowserParts(fileId: string, partNumbers: number[]) {
	return (await helios.uploads.signParts(fileId, partNumbers)).parts;
}

export async function storedBrowserParts(fileId: string) {
	return (await helios.uploads.listParts(fileId)).parts;
}

export async function finishBrowserUpload(fileId: string, parts: { partNumber: number; etag: string }[]) {
	return helios.uploads.complete(fileId, { parts, store: true });
}

export async function finishBrowserUploadAndEncode(fileId: string, parts: { partNumber: number; etag: string }[]) {
	return helios.uploads.complete(fileId, { parts, encode: { preset: "generic" } });
}

export async function abandonBrowserUpload(fileId: string) {
	return helios.uploads.abort(fileId);
}
```

In the page, pass the `created` result of your start route to `upload`. It sends a single PUT or the parts, depending on the mode the server chose, with bounded concurrency. It retries network errors and renews a part whose URL expired (403). For a multipart upload it returns the parts, which the finish route passes on. A resumed upload passes the parts already stored, from `storedBrowserParts`.

```ts
import { upload, type BrowserUpload, type PartUrl, type UploadedPart } from "@partnrup/helios-sdk/browser";

async function postJson<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body)
	});
	return (await res.json()) as T;
}

export async function uploadVideo(
	file: Blob,
	created: BrowserUpload,
	onProgress: (fraction: number) => void
): Promise<void> {
	const { parts } = await upload(created, file, {
		concurrency: 4,
		onProgress: ({ uploadedBytes, totalBytes }) => onProgress(uploadedBytes / totalBytes),
		signParts: (partNumbers) => postJson<PartUrl[]>("/api/uploads/renew", { fileId: created.fileId, partNumbers })
	});
	await postJson("/api/uploads/finish", { fileId: created.fileId, parts });
}

export async function resumeVideo(file: Blob, created: BrowserUpload): Promise<void> {
	const uploadedParts = await postJson<UploadedPart[]>("/api/uploads/stored", { fileId: created.fileId });
	const { parts } = await upload(created, file, { uploadedParts });
	await postJson("/api/uploads/finish", { fileId: created.fileId, parts });
}
```

Bucket CORS must allow your app's origin and expose `ETag`. Helios sets this from `UPLOAD_ALLOWED_ORIGINS` for each stage, so add your dev origin (for example `http://localhost:5173`) there. Without an exposed `ETag`, `uploadParts` throws `EtagUnavailableError`.

### Errors and retries

Every error the SDK throws is a `HeliosError` with `code`, `status` (absent when no response was received) and `requestId`. The subclasses are:

| Class                                               | When                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `ValidationError`                                   | Invalid body (400), or invalid input caught locally (no `status`)          |
| `AuthenticationError` / `PermissionError`           | Missing, revoked or wrong-scope key (401 / 403)                            |
| `NotFoundError`                                     | Resource not found for this account (404)                                  |
| `ConflictError`                                     | Stale `expectedVersion`, a pending request, or a finished request (409)    |
| `UnprocessableError`                                | Unfetchable source or nothing to encode (422)                              |
| `RateLimitError`                                    | 429; `retryAfterMs` is set when the server sent `Retry-After`              |
| `ServiceUnavailableError`                           | 503                                                                        |
| `ApiError`                                          | Any other error response                                                   |
| `ConnectionError` / `TimeoutError` / `AbortedError` | No response, a timeout or `requests.wait` giving up, or your `AbortSignal` |
| `UploadError`                                       | Storage rejected a part, or the size does not match the declared size      |
| `WebhookError` / `ConfigurationError`               | Signature or payload check failed; invalid client options                  |

Retries follow each method's mode. Idempotent calls (GETs, PUTs, DELETEs and keyed creates) retry 429, 5xx, network errors and timeouts, up to `maxRetries` (default 3). Other writes retry only on 429, so a failed write is never silently repeated. Create calls send one `requestId` per call, which every retry reuses. To make a create safe across process restarts, pass your own `requestId` (a UUID) and store it with your job.

A file that fails the storage check (its bytes do not match its declared type, or it breaks the upload policy) is rejected with a 422 `policy_violation`, and its object is deleted. When `uploads.complete` fails after the bytes were sent, `upload` throws an `UploadCompleteError`. It carries the `fileId` and the API error's `code` and `status`, so call `uploads.complete(fileId, ...)` again to retry without uploading twice. A second complete with different encode options answers 409 `complete_conflict`; for another encode of a stored file, use `encodes.create({ source: { fileId } })`.

```ts
import {
	ConflictError,
	Helios,
	HeliosError,
	RateLimitError,
	TimeoutError,
	UnprocessableError
} from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

try {
	const { request } = await helios.uploads.upload(requireEnv("MEDIA_PATH"), {
		contentType: "video/mp4",
		encode: { preset: "generic" }
	});
	await helios.requests.wait(request!.id, { timeoutMs: 10 * 60_000 });
} catch (err) {
	if (err instanceof UnprocessableError && err.code === "policy_violation") {
		console.log("the file does not match its declared type or the upload policy");
	} else if (err instanceof RateLimitError) {
		console.log("rate limited for", err.retryAfterMs, "ms");
	} else if (err instanceof ConflictError) {
		console.log("conflict", err.code, "- complete the file again with the same fileId");
	} else if (err instanceof TimeoutError) {
		console.log("still running; keep the request id and poll later");
	} else if (err instanceof HeliosError) {
		console.error(err.code, err.status, err.requestId);
	} else {
		throw err;
	}
}
```

### Admin client

`@partnrup/helios-sdk/admin` exports `HeliosAdmin`, which takes an admin key (`sk_admin_...`). Keep it out of account-facing services. Account creation returns the webhook secret once, and key creation returns the plaintext key once, so store both before the call returns. The example below writes them to a file readable only by its owner.

```ts
import { writeFileSync } from "node:fs";
import { HeliosAdmin } from "@partnrup/helios-sdk/admin";
import { requireEnv } from "./requireEnv.js";

const admin = new HeliosAdmin({
	apiKey: requireEnv("HELIOS_ADMIN_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const account = await admin.accounts.create({
	slug: "bella",
	name: "Bella",
	sourceBuckets: [requireEnv("KODAK_SOURCE_BUCKET")],
	destination: { type: "webhook", url: requireEnv("BELLA_WEBHOOK_URL") }
});
const key = await admin.keys.create(account.id, { name: "bella-backend" });

writeFileSync(
	requireEnv("BOOTSTRAP_OUTPUT"),
	JSON.stringify({ accountId: account.id, apiKey: key.key, webhookSecret: account.webhookSecret }),
	{ mode: 0o600 }
);
```

## Versioning

Upgrade the SDK before the server starts sending new event types. An event type this version does not know is rejected by `webhooks.verify` with `WebhookError` code `payload_invalid`. The SDK version is the one in `package.json`.
