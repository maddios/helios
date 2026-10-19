# Helios: standalone encoding + AI post-processing service (bella first, novel fast follow)

## Context

- **Why:** partnrup's player/AI/thumbnail/still tech is moving into bella. It depends on encoding-laravel + icarus (PHP) and on partnrup's cron-driven transcription and AI scene analysis.
- **Kodak:** bella's own media service, Kodak (`/var/www/lionizeai/kodak`), transcodes through AWS Elastic Transcoder (discontinued Nov 2025).
- **Novel:** novel's Cloudinary replacement (~$60K/yr) is the fast follow.
- **Phase 1 scope boundary:**
  - Phase 1 delivers a **standalone, fully documented encoding API** plus a **Node.js SDK package** (`@partnrup/helios-sdk`) that bella and novel will consume later.
  - **No code is written in bella-backend, bella-frontend, novel, Kodak, partnrup, encoding-laravel or icarus.** Those repos are read-only references for behavior, patterns and parity.
  - All files are created in `/var/www/lionizeai/helios`. Locally, Helios reuses the shared `localstack` + `mongodb` containers by default (the `helios` DB sits beside bella's, as in prod). A `standalone` compose profile runs its own LocalStack + `mongodb-atlas-local` on alternate ports. See "Local development & testing".
- **What Helios absorbs:** encoding-laravel (transcoding) **and** icarus (S3 storage gateway, asset registry, upload signing, image resize, CDN delivery) in one service. Not carried over: single-use token URLs, Glacier restore, deferred cross-bucket copy, folder listing.
- **Scope:** Helios is built per the gist ("Helios: Node/Express Encoding Service with ECS Workers") as a general-purpose, multi-tenant service. bella is account #1 and novel #2.
- **Phase 1 adds per-job, API-controlled AI transcription and scene detection.** Both have been requested repeatedly. They are rebuilt from partnrup's broken pipeline, with modernized prompts.
- **Existing assets:** almost none to backfill for bella. novel's migration remains Phase 3.
- **Kodak runs in parallel, project by project:** new features use Helios, and old ones stay on Kodak.
- **Repo:** `/var/www/lionizeai/helios` (empty). References: `/var/www/encoding-laravel/src`, `/var/www/partnrup/src`, `/var/www/partnrup-front/src`, `/var/www/novel`, bella-backend.

## Decisions (user-confirmed)

- **Architecture (gist, revised after the tech-choice review):**
  - **API:** Express on ECS via Copilot.
  - **Analysis Lambda:** ffprobe over a presigned URL → fan-out.
  - **State in Mongo only.** The `helios` DB lives on bella's existing per-env cluster. No DynamoDB; see "Pipeline state & queueing".
  - **Queues: SQS priority queues.** The Mongo heartbeat lease (`LEASE_SEC`) is the item's lock. SQS visibility is at least `LEASE_SEC` and is extended by the heartbeat (`ChangeMessageVisibility` = `VISIBILITY_EXTENSION_SEC`). `maxReceiveCount` + DLQ = retries.
  - **Compute is hybrid; see "Compute tiers".** A Lambda tier handles the primary rendition + its stills + AI steps for short sources. Fargate workers handle everything else. Both run the same container image and handlers.
  - **Callbacks:** FIFO SQS → callback Lambda (HMAC, retries, DLQ).
  - **Images:** CloudFront + a **regional image Lambda origin** (us-east-2, `sharp`, Function URL + OAC). Not Lambda@Edge.
  - **Step Functions** is deliberately not used. It can be added later if workflows grow branching or human-review steps, without changing the Mongo data model.
- **Cut from Phase 1:** on-demand video transforms, public keys (secret keys only), and vector indexing/RAG search (Phase 2).
- **Callbacks:** per item (`partial`) + final, HMAC-signed.
- **Kodak:** stays the raw store + CDN (`assets.lionize.ai`, bucket `${stage}-kodak-media`). bella sends `sourceBucket`/`sourceKey` to Helios. The bucket is allowlisted per account.
- **Encoding params:**
  - bella: ported from encoding-laravel.
  - novel: derived from ffprobing Cloudinary eager outputs.
- **Transcription:** native language + English translation when the native language isn't English.
- **People attributes in AI output:** keep partnrup's fields (gender, approximate age, ethnicity, hair, skin color, facial hair, mood), as nullable "apparent" values.
- **LLM access:** follows bella's `helpers/gpt.ts` pattern:
  - `ModelEffort` tiers map to OpenAI models (currently `gpt-6-luna/sol/astra`), configured in one place.
  - `json_schema` strict structured outputs; no regex JSON scraping.
- **Mongo layer: raw `mongodb` v6 driver + zod.** Each model is a zod schema, an inferred TS type, a typed `collection()` accessor and an index list. The zod schemas are later reused for API validation and SDK types.
- **Repo: npm workspaces monorepo.** Packages are `contracts/`, `core/`, `api/`, `functions/`, `worker/` and `sdk/`. Each one is added to `workspaces` when its build step starts. Step 1 creates `contracts/` and `core/`, and no other package. Internal name `@helios/core`; the SDK will be `@partnrup/helios-sdk`.
- **Child profiles (stills) run inside the parent item.** This matches encoding-laravel's `Encoding/Thread.php:92-104`, where children are processed sequentially from the source in the same job as the parent.
  - The default item (`mp4_360`) therefore writes both `outputs.mp4_360` and `outputs.stills`.
  - `scenes` depends on the default item.
- **Smart-filtered profiles get no item.** No item is created for them, so they don't count toward `pendingItems`.
- **No-audio source:** the `transcribe` item is created with status `SKIPPED`.
  - It is excluded from `pendingItems` and from `scenes`' `pendingDeps`.
  - `scenes` then runs stills-only.
- **Config:** config is read from env and validated with zod. It has no defaults (no fallbacks), so a missing value throws at startup. Routing thresholds are included.
- **`SqsQueue`:** ported from `bella-backend/api/sqsQueue.ts`, with the same API: `poll`, `ack`, `sendMessage`, `sendMessageBatch` (10-message chunks, throws on `Failed`) and queue-URL caching.
  - The endpoint comes from `SQS_ENDPOINT` when set, for LocalStack.
  - It has no "local no-op" mode.

## Presets (Mongo `encoding_presets`; editable without deploy)

**Refinements (enforced by `PresetSchema`).** A profile listed as a child must be `type: "stills"` and not `isDefault`. Every default profile must be `video` or `image`.

**`generic` (bella).** Port of `encoding-laravel/src/config/encoding/profiles/generic_video_profiles.php`, limited to the outputs partnrup consumes:

| prio     | name                | output               | params                             |
| -------- | ------------------- | -------------------- | ---------------------------------- |
| 10       | `mp4_360` (default) | `{id}.mp4`           | h360, 800k VBR, AAC 96k 44.1kHz    |
| 10→child | `stills`            | `tmb/%04d.jpg`       | mjpeg `fps=1/3`, source resolution |
| 40       | `audio`             | `{id}.mp3`           | libmp3lame 92k 44.1kHz             |
| 100      | `mp4_720`           | `{id}_720_1800.mp4`  | h720, 1800k VBR, AAC 256k          |
| 110      | `mp4_1080`          | `{id}_1080_2700.mp4` | h1080, 2700k VBR, AAC 256k         |

- **Shared H.264 settings:** libx264 `faster`, main, `x264opts nr=500:ref=2`, `yadif`, GOP 3×fps, 30fps, `+faststart`.
- **Smart filter:** drop a non-default profile if `targetH - 100 > sourceH`. The default is always kept, capped to source height.
- **Image input:** a full JPG (default) + 1 still.
- **Excluded (re-enable via preset):** tooltips, 2160p, 180p.
- **Preset `postProcess` defaults:** `{ transcribe: true, sceneDetection: true }`.

**`novel_video` (fast follow).** The gist's table, with these verified corrections:

- **Preview** = 1.25× (`e_accelerate:25`), 5 s, no audio.
- **Full/preview chain:** blur-pad if wider than 9:16 → crop if taller → limit 720×1280 / 480×640 (`novel-api/.../migrations/20240108185640-media_transformedSources.ts`).
- **Loading clip:** the same chain + seek 25%, 4 s.
- **Thumbnail:** keep DAR, gradient-border pad when w > h·2/3, frame 0.01 s from the source (`upload-utils.ts:48`).
- **H.265:** encoded, gated by `h265Enabled`.
- **Preset `postProcess` defaults:** off.

## Compute tiers (Lambda for the primary rendition of short sources, Fargate for the rest)

**Routing** is decided by the analyze Lambda from `sourceMetadata`:

| Item                                                                         | Short/small source (≤ `LAMBDA_MAX_DURATION_SEC` and ≤ `LAMBDA_MAX_SOURCE_BYTES`) | Long/large source |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------- |
| Default profile + its children (e.g. `mp4_360` + `stills`)                   | `lambda-p1`                                                                      | `fargate-p1`      |
| `transcribe`, `scenes`                                                       | `lambda-ai`                                                                      | `fargate-p3`      |
| Other renditions/profiles (`mp4_720`, `mp4_1080`, `audio` MP3, novel extras) | `fargate-p2` (always)                                                            | `fargate-p2`      |
| Re-encode / bulk                                                             | `fargate-p4`                                                                     | `fargate-p4`      |

- **`transcribe` depends on the source, not on the `audio` profile.** It derives its own mono 16 kHz low-bitrate audio with ffmpeg, so shorts get transcripts without waiting for Fargate. The MP3 profile remains a deliverable for partnrup parity.
- **Lambda tier:**
  - The `encoder` Lambda is the worker image with a Lambda entrypoint.
  - SQS triggers it directly (event source mapping) with `MaximumConcurrency = LAMBDA_MAX_CONCURRENCY`. That is the built-in "more room → run more" control, so this tier needs no scaler.
  - Memory and ephemeral storage are configurable (`ENCODE_LAMBDA_MEMORY_MB`, up to 10 GB; `/tmp` up to 10 GB). Timeout is 15 min, and the queue's visibility timeout is longer than the function timeout.
- **Overflow to Fargate, no code:**
  - `lambda-p1` has `maxReceiveCount` 2, and **its redrive target (DLQ) is `fargate-p1`**.
  - `lambda-ai` redrives to `fargate-p3`.
  - A Lambda timeout or out-of-memory error therefore moves the job to Fargate automatically. Only the Fargate queues have a terminal DLQ (→ the `dlq` consumer Lambda).
- **Fargate tier:**
  - Standalone `RunTask` workers (tag `startedBy=helios-worker`) long-poll `fargate-p1`→`p4` in order.
  - The **scaler Lambda** (invoked async after each Fargate enqueue + every minute) starts `max(0, min(backlog, MAX_WORKERS) - running)` **burst** tasks, where backlog is the visible plus in-flight messages across `fargate-p1..p4`. Burst tasks self-exit after `WORKER_IDLE_TIMEOUT_SEC`.
- **Deploy-time options** (serverless `custom` per stage → env):

| Option                                                | Purpose                                                                                                                                                                       | Example dev / prod        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `WARM_WORKERS`                                        | Number of always-on Fargate workers (0 = none). The scaler keeps this many **warm** tasks (tag `role=warm`, `IDLE_EXIT=false`) running; burst tasks (`role=burst`) idle-exit. | 0 / 1                     |
| `MAX_WORKERS`                                         | Cap on Fargate tasks                                                                                                                                                          | 3 / 20                    |
| `WORKER_IDLE_TIMEOUT_SEC`                             | Burst task idle exit                                                                                                                                                          | 600 / 1800                |
| `WORKER_CPU` / `WORKER_MEMORY` / `WORKER_SPOT`        | Fargate task size and Spot use                                                                                                                                                | 4096 / 8192 / true for p4 |
| `LAMBDA_MAX_DURATION_SEC` / `LAMBDA_MAX_SOURCE_BYTES` | Routing thresholds                                                                                                                                                            | 180 / 500 MB              |
| `LAMBDA_MAX_CONCURRENCY`                              | Cap on concurrent Lambda encodes                                                                                                                                              | 5 / 50                    |
| `ENCODE_LAMBDA_MEMORY_MB`                             | Encoder Lambda size                                                                                                                                                           | 4096 / 10240              |

- **Expected latency:**
  - Shorts: first playable output in ~2–10 s after analysis.
  - Long/large sources: the time to encode, plus a ~30–60 s Fargate cold start when `WARM_WORKERS=0` (shorter with a SOCI index on the image).
  - Secondary renditions arrive later, from Fargate.
- **Image:** one multi-stage Dockerfile: static ffmpeg (only the needed codecs) + Node + the Lambda runtime interface client. ECR with a SOCI index to speed up Fargate pulls.

## Pipeline state & queueing (Mongo + SQS; no locks, no sweep)

- **`pipeline_items`** (Mongo, TTL index on `completedAt` for cleanup, 30 days after `completedAt`): one document per profile/step. Fields: `{requestId, assetId, accountId, kind, profile, queue, priority, status (BLOCKED|QUEUED|IN_PROGRESS|COMPLETE|SKIPPED|CANCELLED|ERROR), messageId, pendingDeps: [itemIds], dependents: [itemIds], attempts, progress, error, output, usage, startedAt, completedAt, createdAt}`. Item `_id` is `${requestId}:${key}`. An item is BLOCKED iff `pendingDeps` is non-empty at creation. Each worker writes only its own document.
- **`requests`:** `{_id, accountId, assetId, clientRequestId, mode, presetSnapshot, postProcess, assetVersion, pendingItems: [itemIds], status, callbackUrl, enqueuedAt, completedAt, createdAt}`. `_id` is always a server UUID. `clientRequestId` is the client-supplied id (exposed as `requestId` in the API) or, if none is sent, the `_id`. Unique index `{accountId, clientRequestId}` (see "Assets & requests"). `pendingItems` holds the ids of all non-SKIPPED items.
- **Asset outputs** are a **map keyed by profile** (`outputs.mp4_720`), written with `$set` on the worker's own key, so concurrent writers never touch the same field. Mongo single-document atomicity is sufficient.
- **Queues** (`helios-{stage}-…`): `lambda-p1`, `lambda-ai` (redrive to Fargate), and `fargate-p1` … `fargate-p4` (each with a terminal DLQ). Routing is described under "Compute tiers". Fargate workers long-poll p1→p4 in order.
- **Tenant fairness (addition 6):** when `SQS_FAIR_QUEUES=true`, every enqueue sets `MessageGroupId = accountId`, which turns on SQS fair queues on the standard queues. It is `true` locally (LocalStack 4.14, the last free community release, supports it; 4.5 rejected it) and on AWS. The flag stays so older emulators can still be used. Dedicated per-client queues are left for later, if a big tenant ever starves the others.
- **Cancellation (addition 4):**
  - A `CANCELLED` item/request status and `DELETE /requests/:id`.
  - BLOCKED/QUEUED items flip immediately. Workers check status before starting and on each heartbeat, then abort.
  - The completion handler treats CANCELLED as terminal.
- **Worker claim:** see `claimItem` under "Step 2 design". A claim succeeds only when the item is QUEUED, BLOCKED with no pending dependencies, or IN_PROGRESS with a stale lease. A redelivery while the lease is fresh is `busy` and reports the holder's `messageId`. A different messageId is acked, because the holder's own message covers crash recovery. The same messageId is left unacked. Concurrent deliveries yield exactly one claim. A CANCELLED request is handled before the claim, as described under Completion handler.
- **Dependency edges are required or optional.** `pendingDeps` lists every dependency. `requiredDeps` is the subset that must complete: scenes requires the default encode item and treats transcribe as optional.
  - When a dependency settles ERROR, SKIPPED or CANCELLED and it is in `requiredDeps`, the dependent is settled SKIPPED with `error: "dependency <depId> <status>"` through the same `completeItem` path. That cascades recursively and is idempotent.
  - An optional dependency that fails is released normally, so scenes runs without the transcript.
  - COMPLETE always releases normally.
- **Completion handler (idempotent; the SQS message is deleted last):**
  1. Settle the item from any non-terminal status (BLOCKED, QUEUED, IN_PROGRESS) to the terminal status. The settle stores `output` (`{ assetOutputs, activeStill }`) on the item, `$push`es the attempt's usage, `$unset`s `error` when COMPLETE, sets `error` otherwise, and sets `completedAt`. A late or losing completion matches nothing.
  2. Re-read the item and run the handoff from its stored status and output, never from the input.
  3. Write asset outputs only when the stored status is COMPLETE, from the stored `output`, with the filter `{_id, accountId, version: {$lte: request.assetVersion}}`. A non-match is not an error. An older request therefore never overwrites a newer re-encode's outputs.
  4. Release dependents: required failures cascade, anything else does `$pull` pendingDeps and then send-then-flip (BLOCKED to QUEUED).
  5. Enqueue the per-item callback through `sendCallback(body, deduplicationId)`, the single place for `callbacks.fifo` with `groupId = requestId`.
  6. Request: `findOneAndUpdate({_id, pendingItems: itemId}, {$pull}, {returnDocument: after})`. If that matches nothing, `findOne` (throw if the request is missing). Finalize when `pendingItems` is empty and the status is IN_PROGRESS. Cancelled requests are not finalized here; the step-3 cancel route owns that.
  7. The SQS message is deleted last.
- **Terminal rerun:** `claimItem` returns `{claimed: false, reason: "terminal", status}` for a terminal item. The worker then runs `completeItem({itemId, status})` to repair a crashed handoff. Claim order: load the item, then the request. A CANCELLED request settles the item CANCELLED through `completeItem` (restricted to non-terminal items) and returns `cancelled` without incrementing attempts.
- **Callback consumers** must be idempotent and read the terminal status from `job_reports`. Terminal reruns re-send callbacks beyond the FIFO dedup window, so duplicates are expected.
- **Usage:** each attempt pushes one `Usage` entry onto its item (`computeTier`, `computeSec`, `memoryMb`, plus `vcpu` and `spot` for fargate, and optional output, audio and LLM fields). Failed attempts are recorded with `recordFailedAttempt` before the error is rethrown. Interrupted (SIGTERM) attempts are metered too: `releaseLease` pushes their usage under the lease. Superseded attempts pass their usage to `completeItem`. The job report stores `usage` as a `UsageSummary` with only the metrics that are present, per tier. LLM tokens per model live only in `ResourceUnits.llmTokens`, never in `UsageSummary`.
- **Terminal statuses:** COMPLETE, SKIPPED, ERROR and CANCELLED all set `completedAt`, which starts the TTL.
- **Crash at any point:** the message reappears after the visibility timeout, and the handler reruns safely.
- **Fan-out recovery (the scaler owns it):** once the `requests` doc is persisted, finishing the request is Helios's job, never the client's.
  - The scaler's 1-minute schedule also runs the fan-out resume for every request with `status: IN_PROGRESS`, no `enqueuedAt`, and `createdAt` older than `FANOUT_RESUME_AFTER_SEC`. Fan-out is idempotent, so this is safe.
  - This needs a partial index on `{createdAt: 1}` where `enqueuedAt` doesn't exist.
- **Client-facing errors:**
  - `POST /encode` returns 202 with the request id as soon as the request doc is written, even if a later fan-out write (items, SQS) fails; the resumer completes it.
  - The API returns `503 Service Unavailable` ("can't process right now, try again later") only when the request can't be persisted at all, i.e. a system outage.
  - The SDK still generates a `requestId` internally and reuses it on network retries for idempotency, invisibly to the user.
- **DLQ consumer Lambda:** the callback consumer derives the `asset.deleted` event from the request mode (the message carries only `type`, `requestId`, and `itemId`). Redeliver is allowed only for terminal requests. Analyze DLQ: calls `failAnalyze(requestId)`. Marks the item ERROR (or SKIPPED for optional AI steps), releases dependents according to policy, `$pull`s the item from `pendingItems`, and fires the error callback.
- **SIGTERM (Fargate):** release the lease (QUEUED, attempt usage recorded, `attempts` decremented), send a fresh copy of the message, and delete the old one. A stale lease matches nothing, and the copy is still sent.
- The Lambda entrypoint runs the same handler. If it returns an error or times out, the message isn't deleted, so SQS redelivers it and then redrives it to Fargate.

## AI post-processing (Phase 1)

**Per-job control.** `POST /encode`, `/upload-and-encode` and `/re-encode/:assetId` accept:

```ts
postProcess?: {
  transcribe?: boolean | { language?: string /* ISO hint */, translateToEnglish?: boolean /* default true */ }
  sceneDetection?: boolean
}
```

- Values not given fall back to the preset defaults. `sceneDetection` doesn't require transcription: without a transcript it runs on stills only.
- Adds `POST /assets/:assetId/post-process` with the same body, to run or re-run AI steps on an existing asset without re-encoding (also useful for prompt upgrades).

**Pipeline modelling.**

- Post-process steps are `pipeline_items` with `kind: 'transcribe' | 'scenes'`, created `BLOCKED` with `pendingDeps`. The completion handler (see "Pipeline state & queueing") releases them.
- They run on `lambda-ai` for short sources (redriving to Fargate on failure) and on `fargate-p3` otherwise. Same handlers, and SQS leases/retries apply.
- Dependencies:
  - `transcribe` has no dependencies; it extracts its own audio from the source.
  - `scenes` depends on `stills` (via the default profile) and, when enabled, on `transcribe`.
  - If the source has no audio stream, `transcribe` completes as `skipped` and `scenes` proceeds stills-only.
- They count toward the request's `pendingItems`, so the final callback fires after AI completes. Per-item callbacks expose `transcript_ready` / `scenes_ready`.

**Transcription worker step.** It fixes partnrup's bugs: the 25 MB limit, terminal errors, dropped segments, duplicate rows and hardcoded English.

1. ffmpeg derives a transcription-optimized audio file from the source: mono, 16 kHz, low-bitrate. If it is still over the provider limit, split it into chunks with a small overlap, transcribe each, then offset and merge the segments.
2. Call the OpenAI audio transcription API with segment-level timestamps. The model is set in `config/ai.ts`; it must support timestamped segments (`whisper-1` verbose_json is the known-good baseline).
3. If the detected language ≠ English and translation is enabled, produce an English track via the translation endpoint.
4. Store `transcripts` (Mongo): `{accountId, assetId, language, isTranslation, segments:[{start,end,text}], text, durationSec, model, createdAt}`. Write SRT/VTT/TXT to S3 under `{slug}/media/{assetId}/transcript/{lang}.{srt|vtt|txt}` (SRT→VTT/TXT conversion helper).
5. Errors are retried via SQS redelivery (`maxReceiveCount` 3). The DLQ consumer marks the step SKIPPED (optional AI step) and lets `scenes` proceed stills-only. The error message is stored on the item.

**Scene detection worker step.** It replaces `Vision.php` + `SearchMediaProcessingCron::fetchTimestampMetadata`/`fetchContentMetadata`, as one structured call per video.

- **Input:**
  - Stills, each labelled with its exact `timestampSec` from the stills output metadata (not a hardcoded interval).
  - Transcript segments as `[start-end] text`, plus duration.
  - **Budget:** cap images at `MAX_STILLS` (config, e.g. 120) by even sampling. Videos longer than one window are processed in time windows, and the scenes are merged by stitching at window boundaries.
  - Images are passed as presigned/CDN URLs at `detail: low`.
- **Prompt (rewritten):**
  - A system message with a concise role and task, and a user message with the data.
  - Drop partnrup's "RULES / AI TODAY" boilerplate and the conflicting Markdown instruction.
  - Explicit scene-boundary criteria: location, activity or topic change; merge same-topic runs.
  - Timestamps must be chosen from the provided still/transcript times.
  - No invented speech when there is no transcript.
  - Temperature low (0–0.2) for the scene step.
  - Prompt text lives in `worker/ai/prompts/` as versioned templates. `promptVersion` is stored with the results.
- **Output (strict `json_schema`)** → Mongo `scene_analyses`:

```ts
{ assetId, accountId, promptVersion, model, transcriptLanguage|null,
  summary: { title, description, setting, products:[{type,name}], people: Person[], moods:[], tags:[] },
  scenes: [{ sceneNumber, startSec, endSec, reasonForTransition, transcriptExcerpt|null,
             description, setting, products:[{type,name}], people: Person[],
             representativeStillIndex /* best still for vid-grab / AI thumbnail */ }] }
Person = { species, gender|null, approximateAge|null, ethnicity|null, skinColor|null,
           hairColor|null, hairType|null, hairLength|null, facialHair|null, mood|null }
```

- The single call replaces partnrup's two gpt-4o calls (summary + timestamp).
- `representativeStillIndex` serves partnrup's vid-grab mapping (`mediaVidGrab.vue:41-66`) directly, with no "first still ≥ scene time" heuristic.
- When the account's `features.peopleAttributes` is off, the schema and prompt omit the `people` attribute fields (see "Privacy & deletion").
- **Image assets:** the same step with a single image produces `summary` only.

**Read API.**

- `GET /assets/:assetId/transcripts` returns the segments, plus SRT/VTT/TXT CDN URLs per language.
- `GET /assets/:assetId/scenes` returns the latest analysis.
- Both are included in `GET /assets/:assetId` as `postProcess: {transcribe:{status}, scenes:{status}}`.

**Phase 2 hook (RAG).**

- `scene_analyses` and `transcripts` are shaped for chunk-level embedding: scenes and fixed transcript windows, plus an asset-level summary.
- Add `embed` items + a Mongo Atlas Vector Search index (filtered by `accountId`) and `POST /search` later. A dedicated cluster is used only if the shared one can't host it.

## Assets & requests

- **Active still / poster (addition 1, a parity fix for encoding-laravel `Thread.php:595-630`):**
  - `media_assets.activeStill = {index, timestampSec, selectedByUser}`.
  - Default is still 0.
  - On re-encode, a still the user selected maps to the new still with the nearest `timestampSec`.
  - `PATCH /assets/:id/active-still`.
  - _Build step:_ model now; handled by the worker in step 2; route in step 3.
- **Preset snapshot (addition 2):**
  - Fan-out stores the resolved profiles + `postProcess` defaults on the asset (`presetSnapshot`, `presetVersion`) and on the request.
  - Re-encode uses the asset's snapshot by default. `refreshPreset: true` takes the current preset instead; there is no old/new merge, unlike encoding-laravel.
  - _Build step:_ now.
- **Idempotency through a client-supplied request id (addition 3):**
  - The request id itself is the idempotency key. Callers may send their own `requestId` (a UUID), stored as `clientRequestId` and unique per account.
  - A repeat returns the existing request. A repeat with a different asset or mode is rejected. With no `requestId` given, the server generates one.
  - `requests.assetVersion` is the asset version the request leaves behind: `version + 1` for re-encode, otherwise the current version. The asset update applies it with `$max`, so a fan-out resumed after a crash bumps the version exactly once.
  - A server-generated id alone can't dedupe, because a client whose POST timed out never received it.
  - _Build step:_ model/fan-out now; route in step 3.
- **Usage metering for dashboard stats (addition 5):**
  - Items record `usage: {computeTier, computeSec, outputBytes, audioSec, llm: [{model, inputTokens, outputTokens}]}`, plus the tier fields.
  - `job_reports` rolls these up per request.
  - `GET /usage?from&to&groupBy` serves the console.
  - _Build step:_ schema now; filled in by the workers.

## Cost units (stored once per request)

- Helios stores resource units, never dollars or a currency. Dollar prices are derived outside Helios from these units, so price changes never require a data migration.
- `computeResourceUnits(usages)` is pure. It produces `ResourceUnits` (contracts): `lambdaGbSeconds` (Σ computeSec × memoryMb/1024), `fargateVcpuSeconds`, `fargateGbSeconds`, `fargateSpotVcpuSeconds`, `fargateSpotGbSeconds` (on-demand split from spot by the `spot` flag), `outputGb` (Σ outputBytes / 1024³), `transcriptionAudioSeconds`, and `llmTokens` per model. Every field is a real sum, starting from 0.
- Each usage entry carries what is needed to derive units: `memoryMb` (required), `vcpu` and `spot` (required for fargate). The worker fills them from `WORKER_MEMORY_MB`, `WORKER_VCPU` and `WORKER_SPOT`, which are required with no defaults.
- `finalizeRequest` computes the units once and stores them on the job report (`resourceUnits`). It then increments `usage_daily` (`_id: ${accountId}:${YYYY-MM-DD}`, the day is the UTC day of the finalize time) with the request count, each unit field, and LLM tokens per model.
- **Exactly once:** setting `unitsRecordedAt` on the job report (guarded by `{unitsRecordedAt: {$exists: false}}`) and the `usage_daily` `$inc` run in one Mongo transaction (`withTransaction`). A failed increment rolls back the marker, so the next finalize retries it. Tests use the replica-set memory server.
- **LLM model keys:** `usage_daily` paths use `mongoKey(model)`, which escapes `%`, then `.` and `$` (`%25`, `%2E`, `%24`).
- **Display dimensions:** `SourceMetadata.width`/`height` are the display dimensions, after rotation is applied by analyze. The worker applies EXIF orientation (`sharp.rotate()`) to every image output, so stored sizes match what viewers see.

## API notes

- **OpenAPI (addition 7):** generated from the zod schemas (`@asteasolutions/zod-to-openapi`) and served at `/docs`. The SDK types come from the same schemas. _Build step:_ 3 + 8.
- **Callback delivery log + redeliver (addition 8):**
  - A `callback_deliveries` collection, `GET /requests/:id/callbacks` and `POST /requests/:id/callbacks/redeliver`.
  - _Build step:_ 3 + 4.
- **`dryRun` (addition 12):** `POST /encode?dryRun=true` returns the `planItems` output (items, queues, deps) and writes nothing. _Build step:_ 3.
- **Other routes added by the additions:**
  - `DELETE /requests/:id` (cancel, addition 4), _build step:_ 3.
  - `PATCH /assets/:id/active-still` (addition 1), _build step:_ 3.
  - `GET /usage` (addition 5), _build step:_ 3.
  - `DELETE /assets/:id` (purge, addition 11), _build step:_ 3.
- **Preset routes:** see "Preset management API".

## Observability

- **Logs and tracing (addition 9):**
  - pino JSON logs with `accountId`/`requestId`/`itemId`/`assetId`, propagated as SQS message attributes through API → Lambda → worker.
  - Workers log ffmpeg progress into `pipeline_items.progress`, and the last 50 ffmpeg stderr lines into `error` on failure. This matches the per-thread visibility encoding-laravel had.
  - dd-trace is optional (bella uses Datadog).
  - _Build step:_ the logger in core now; used throughout.
- **Alarms + Slack (addition 10):**
  - CloudWatch alarms on DLQ depth, `ApproximateAgeOfOldestMessage` per tier, the Lambda→Fargate redrive rate, and the error rate.
  - They go to an SNS topic, then Slack through AWS Chatbot (no code), with a channel configured per stage.
  - _Build step:_ 9.

## Privacy & deletion

- **Right to be forgotten (addition 11):**
  - An account-level `features.peopleAttributes` toggle. When it's off, the schema and prompt omit the people attribute fields.
  - `DELETE /assets/:id` returns 202 and runs a `purge` item:
    - cancels in-flight requests for the asset;
    - deletes the S3 outputs under `{slug}/media/{assetId}/`;
    - deletes the variants under `resize_cache/{key}/…`;
    - issues a CloudFront invalidation for the asset prefix + the exact `/img/...` variant paths found in `resize_cache`;
    - deletes the Mongo transcripts/scene_analyses/items;
    - tombstones the asset;
    - sends an `asset.deleted` callback.
  - Kodak-owned source objects remain the caller's responsibility.
  - _Build step:_ the toggle now; purge in steps 2–4.

## Corrections to the gist (applied)

1. **Priority:** set by queue tier (p1→p4) rather than a sort key. Every video's default rendition is processed before secondary profiles.
2. **Leases:** a Mongo heartbeat lease (`leaseId`, `heartbeatAt`, `LEASE_SEC`). SQS visibility is at least the lease and is extended by the heartbeat. Redelivery handles worker crashes, so no sweep job is needed. On SIGTERM, the lease is released and the message is requeued.
3. **Finalize:** the request's `pendingItems` id set in Mongo; the caller that empties it finalizes. Error outcomes (via the DLQ consumer) also produce callbacks; encoding-laravel never sends them.
4. **Resolution:** never upscale.
5. **Versioning:** bump only on re-encode.
6. **Schema:**
   - `EncodingProfile.version`.
   - `MediaAssetOutput{profileName, profileVersion, kind, codec, width, height, duration, bitrate, fileSize, gated}`.
   - The stills output holds `items:[{key,timestampSec}]`.
   - `MediaAsset.externalId`, plus full `sourceMetadata`.
7. **API keys:** `sk_live_` keys stored as SHA-256 with an indexed lookup.
8. **One URL scheme:**
   - Keys: `{slug}/media/{assetId}/…`, `{slug}/files/…`.
   - CDN: `?v=` with only `v` allow-listed. Outputs use stable keys, so a re-encode overwrites them in place. Step 7 adds a CloudFront invalidation of `/{slug}/media/{assetId}/*` after a re-encode finalizes. Not built yet.
   - Images: `/img/w_,h_,q_,f_,c_pad,b_HEX/{key}` (replaces icarus `?width&height&background_fill`).
9. **`POST /files`** for raw uploads. **Multipart presigned uploads** for large files (replaces icarus `sign_auth` + Evaporate): `POST /uploads/multipart` (create, returns `uploadId` + part URLs), `POST /uploads/multipart/:uploadId/complete`, `DELETE /uploads/multipart/:uploadId`. Same flow as bella's `cloud/kodak.ts` multipart functions.
10. **Image transforms run on a regional Lambda origin**, which avoids Lambda@Edge's 1 MB limit, us-east-1 deploys and lack of env vars.
    - CloudFront's `/img/*` behavior uses an origin group: first the S3 `resize_cache/` variant, then on 403/404 the image Lambda Function URL (OAC-signed).
    - The Lambda resizes the original with `sharp`, writes the variant to `resize_cache/`, and returns the bytes.
11. **Kodak and other source buckets:** per-account allowlist plus IAM `s3:GetObject`.
12. **Analysis:** ffprobe over a presigned URL. The Fargate fallback is only for Lambda timeouts.
13. **SSRF guard** for URL ingest and callback targets.
14. **Compute:** 30 GB ephemeral storage; Fargate Spot capacity provider for bulk.

## Repo layout (`/var/www/lionizeai/helios`; Node 22, TS, jest + mongodb-memory-server, prettier from bella)

- `contracts/`:
  - zod schemas and inferred types shared with clients: encode/upload requests, `postProcess`, preset/profile, asset, outputs, transcript, scenes, callback payloads, errors and statuses.
  - The OpenAPI registry.
  - Step 1 creates the subset it needs: `postProcess`, preset/profile, `sourceMetadata`, statuses, item kinds and queue names.
- `core/`:
  - Models: accounts, api_keys, media_assets, encoding_presets, job_reports, transcripts, scene_analyses.
  - Plus `requests` and `pipeline_items` (TTL).
  - Fan-out, including post-process items and `pendingDeps`.
  - Idempotent completion handler (release dependents, finalize), CDN URLs, `SqsQueue` (from `bella-backend/api/sqsQueue.ts`), SSRF guard, HMAC.
  - `ai/llm.ts`: the effort-tier + `json_schema` client modelled on `bella-backend/helpers/gpt.ts`.
  - Module layout: `core/src/<module>/` with each module exposing only its `index.ts`. Modules: `assets`, `presets`, `pipeline`, `queue`, `storage`, `cdn`, `callbacks`, `ai`, `usage`, plus `db/`, `models/`, `logger/` and `config/`. Step 1 creates `db`, `models`, `presets`, `pipeline`, `queue`, `logger` and `config`. The other modules are added in their build steps.
- `api/`: Express routes (encode, upload-and-encode, files, presigned-url, status, assets, transcripts, scenes, post-process, re-encode, health); `copilot/` modelled on bella's manifest.
- `functions/` (serverless.yml, us-east-2):
  - `analyze`.
  - `encoder` (worker image, Lambda entrypoint; SQS event sources `lambda-p1` / `lambda-ai` with `MaximumConcurrency`).
  - `scaler` (async invoke + 1-min schedule → keeps `WARM_WORKERS` warm tasks running and starts burst tasks up to `MAX_WORKERS`).
  - All of the "Compute tiers" deploy options live in `custom.<stage>`.
  - `callback` (FIFO → HMAC webhook).
  - `dlq` (marks ERROR / SKIPPED, finalizes).
  - `image` (`sharp`, Function URL).
  - Plus the SQS queues p1–p4 + DLQs + the callback FIFO queue.
- `worker/`:
  - Dockerfile (ffmpeg x264/x265/vpx/opus/aac/mp3lame) and the tiered SQS poll loop with visibility heartbeat.
  - Step handlers by kind: mp4, stills, mp3, image, `transcribe`, `scenes`.
  - `ai/prompts/` and the SRT/VTT utilities.
- `infra/init.yml`: S3, CloudFront (+ `/img/*` origin group, cache policy, OAC for S3 and the Lambda URL).
- `sdk/`: `@partnrup/helios-sdk` with types for assets, transcripts, scenes and callbacks, plus docs. Types come from `contracts/`; the SDK never depends on `core`.
- `scripts/`: seed-account, seed-presets, sample-cloudinary-outputs, cloudinary-download (Phase 3).

## Modularity rules (apply to every step)

- **Workspace packages with one direction of dependency:**

  ```
  contracts ← core ← api | functions | worker
  contracts ← sdk
  ```
  - `contracts` holds the zod schemas and inferred types shared with clients:
    - encode/upload requests, `postProcess`, preset/profile, asset, outputs, transcript, scenes, callback payloads, errors and statuses;
    - the OpenAPI registry.
  - The SDK never depends on `core` (Mongo/AWS).

- **Feature modules.** `core/src/<module>/` (`assets`, `presets`, `pipeline`, `queue`, `storage`, `cdn`, `callbacks`, `ai`, `usage`) each exposes only its `index.ts`. A dependency-cruiser rule in `npm run lint` forbids deep imports and import cycles.
- **AWS behind small adapters.** `Queue`, `ObjectStore` and `Cdn` interfaces with SQS/S3/CloudFront implementations. Logic depends on the interfaces, so tests mock at the boundary.
- **Step handlers.** A `kind → handler` registry in the worker: a new step kind is one new file plus a registry entry, and there are no switch chains.
- **Small files and functions.** Each file has one responsibility, with no god-services.

## Preset management API (new; build step 3, SDK step 8)

- **Routes:** `GET/POST /presets`, `GET/PATCH/DELETE /presets/:name`, and `PATCH /presets/:name/profiles/:profile`. Presets are scoped per account; system presets like `generic` can be read and cloned but not edited.
- **Versioning:** each edit bumps `version` (the profile's `version` too). Existing assets keep their snapshot until a re-encode with `refreshPreset: true` (addition 2).
- **Validation:** profile params are validated by `contracts` schemas, e.g. codec/height/bitrate ranges and that `children` exist. Validation errors are returned as typed errors.
- **Dry run:** `POST /presets/:name/dry-run` takes a `sourceMetadata`, or an existing `assetId`, and returns the planned items. It reuses `planItems`.

## SDK design (`@partnrup/helios-sdk`; build step 8, typed from `contracts`)

**Simple path, a few lines per task:**

```ts
const helios = new Helios({ apiKey });
const { asset, request } = await helios.uploads.uploadAndEncode(file, { preset: "generic", onProgress });
await helios.requests.wait(request.id); // polling helper with backoff
const event = helios.webhooks.verify(rawBody, signatureHeader); // typed discriminated union
```

**Advanced, through resource namespaces:**

| Namespace     | Methods                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uploads`     | Manual multipart: `create`/`signParts`/`complete`/`abort`. `uploadAndEncode` handles part sizing, concurrency, per-part retry, `AbortSignal` and progress. |
| `encodes`     | `create` (`dryRun`, `requestId` idempotency, `postProcess`), `reencode` (`refreshPreset`)                                                                  |
| `requests`    | `get`, `cancel`, `wait`, `callbacks.list`/`redeliver`                                                                                                      |
| `assets`      | `get`, `delete` (purge), `setActiveStill`, `postProcess`                                                                                                   |
| `transcripts` | `list`                                                                                                                                                     |
| `scenes`      | `get`                                                                                                                                                      |
| `presets`     | CRUD, `updateProfile`, `clone`, `dryRun`                                                                                                                   |
| `files`       |                                                                                                                                                            |
| `images`      | `url(key, { w, h, q, f, pad, bg })`: a pure URL builder                                                                                                    |
| `usage`       | `get`                                                                                                                                                      |

**Implementation rules:**

- **Publishing happens only through GitHub Actions**, in the deploy workflow, using the `NPM_AUTH_TOKEN` repo secret. Nothing is published from a local machine.
- Built on native `fetch`, with no AWS SDK.
- Typed `HeliosError` subclasses with `code`, `status` and `requestId`.
- Automatic retries on 429/5xx, with the idempotency key reused across them.

**Self-documenting, for both humans and agents:**

- **TSDoc on every public method, type and field**, with `@example`, `@throws` and default values. The types come straight from the zod schemas, so editors and agents see the exact shapes.
- **The package ships these docs:**
  - `README.md`: quickstart + one recipe per task.
  - `AGENTS.md` / `llms.txt`: a dense, agent-oriented reference covering when to use which method, the webhook event catalogue, the idempotency/retry semantics, and integration checklists for bella (Kodak source buckets) and novel.
  - `docs/` generated with TypeDoc.
- **`sdk/examples/*.ts`** are type-checked in CI so they never rot: simple upload, Kodak-source encode, webhook handler, preset customization, re-encode with refresh, right-to-be-forgotten purge.
- **API docs:** OpenAPI generated from the same `contracts` and served at `/docs` on the API (addition 7).

## Phases

- **1 (Helios + bella preset + AI):**
  1. Scaffold + contracts + core models + fan-out/deps (preset snapshot, idempotent `requestId`, fair-queue `groupId`, logger).
     - Scaffold: root `package.json` (workspaces `contracts`, `core`), `tsconfig.base.json`, prettier, jest, `.gitignore`, `.nvmrc`, `docker-compose.yml` (`standalone` profile), `local/config.json` + loader, queue topology, `local:bootstrap`, step-1 e2e (`test:local`).
     - Contracts: the step-1 subset (see "Repo layout").
     - Models: `activeStill`, `CANCELLED` status, `usage` on items, server `requests._id` with a client `clientRequestId` (API `requestId`), `features.peopleAttributes`, TTL and unique indexes via `ensureIndexes()`.
     - `config.ts`, `SqsQueue` port, `presets/generic.ts`, `planItems` (smart filter, image input, `postProcess` resolution, routing table, dependencies, `encode` / `reencode` / `postProcess` modes), `fanOut` (preset snapshot, idempotent on `requestId`, `sendMessageBatch` with `MessageGroupId = accountId`).
     - Logger in core (pino child helper).
  2. Worker encode steps + golden tests.
     - Active still handled by the worker (addition 1).
     - Cancellation checks in the worker before start and on each heartbeat (addition 4).
     - Usage filled in by the workers (addition 5).
     - ffmpeg progress and stderr logging (addition 9).
     - Purge item steps, in steps 2–4 (addition 11).
  3. API + auth + seeds.
     - Preset management API routes and the preset dry run (see "Preset management API").
     - OpenAPI `/docs` (addition 7, with step 8).
     - `dryRun` on `POST /encode` (addition 12).
     - Cancel route `DELETE /requests/:id` (addition 4).
     - Active-still route `PATCH /assets/:id/active-still` (addition 1).
     - Usage route `GET /usage` (addition 5).
     - Callback log routes `GET /requests/:id/callbacks` and `POST /requests/:id/callbacks/redeliver` (addition 8).
     - `DELETE /assets/:id` purge route (addition 11).
  4. Lambdas.
     - Callback delivery log collection and redeliver (addition 8).
     - Purge steps continued (addition 11).
  5. Transcription step.
  6. Scene detection step + prompt eval on ~20 partnrup sample videos, compared against existing `timestamp_analysis_json`.
     - `features.peopleAttributes` toggle applied to the schema and prompt (addition 11).
  7. Image Lambda + CloudFront origin group.
     - CloudFront invalidation for purge (addition 11).
  8. SDK.
     - Typed from `contracts`; OpenAPI shares the same schemas (addition 7).
  9. Infra + dev deploy.
     - CloudWatch alarms and SNS → Slack via AWS Chatbot (addition 10).
- **1b (novel fast follow):** novel filter chains, VP9/H.265, `novel_video` preset.
- **2 (first phase that touches other repos):**
  - RAG: embeddings + Atlas Vector Search + `/search`.
  - **bella integration:** `api/helios.ts` (Kodak client pattern, secrets via `setup/configuration.js`) and `webhook/helios.ts` (HMAC over `rawBody`, `timingSafeEqual`, `webhookContext`).
  - novel integration (gist 2a–2c).
- **3:** novel Cloudinary migration (cut new uploads over first, then backfill).
- **1h:** console.

Execution: I orchestrate, haiku subagents build modules (context under 100k), and opus audits each phase and the prompts.

## Step 2 design: worker + completion handler

**ffmpeg parity with encoding-laravel.** Commands were reconstructed from `vendor/expo/ffmpeg-sdk` + `Encoding/Thread.php`. The intentional differences are marked ★.

- **Input:** `-y -nostdin -reconnect_on_http_error 503,500 -reconnect_streamed 1 -reconnect_delay_max 2 -reconnect_on_network_error 1 -i <presigned URL>`, plus ★`-progress pipe:1 -nostats` for progress reporting.
- **MP4 (`video` profiles):**
  - Filters: `-vf "yadif=0:-1:0,scale=-2:H"`, where ★`H = min(targetHeight, sourceHeight)` (never upscale; encoding-laravel upscaled a 640p source to 720).
  - Video: `-c:v libx264 -preset:v faster -profile:v main -x264opts nr=500:ref=2 -b:v <k> -r 30 -g 90 -pix_fmt yuv420p`. That is VBR, so `-b:v` only, with no maxrate/bufsize.
  - Audio: `-c:a aac -ac 2 -ar 44100 -b:a <k>`.
  - Container: `-movflags +faststart -dn -f mp4`.
  - ★Mapping: explicit `-map 0:v:0`, plus `-map 0:a:0` only when the source has audio.
- **Stills:**
  - `-vf fps=<fps> -pix_fmt yuvj420p -f image2 tmb/%04d.jpg` at the source resolution, with no yadif.
  - JPEG quality is ffmpeg's mjpeg default, the same as encoding-laravel.
  - `timestampSec = index / fps`, so `0001.jpg` = 0 s, `0002.jpg` = 3 s. encoding-laravel computed this but never stored it; Helios stores it in `items[]`.
- **MP3:** `-vn -c:a libmp3lame -ac 2 -ar 44100 -b:a 92k -f mp3`. ★The stray video flags encoding-laravel emitted are dropped.
- **Parent + children:** run in **one ffmpeg invocation with multiple outputs** (`mp4_360` + `tmb/%04d.jpg`). The source is decoded once, where encoding-laravel ran sequential passes.
- **Image sources:** `image` and `image_still` go through `sharp`, not ffmpeg: a full JPG at the profile quality, plus one still at source resolution.

**Worker (`worker/` package, `@helios/worker`).**

- **`ffmpeg/`:** pure arg builders per profile type (golden-tested against the commands above), a runner (spawn, progress parser, last 50 stderr lines kept for errors), and an ffprobe of each output to fill `MediaAssetOutput`.
- **`handlers/`:** a registry keyed by item kind (`encode` → `encodeHandler`). `encodeHandler` dispatches per profile type to `video/` or `image/`, both of which build local paths with the shared `localOutputPath`, and it composes the parent + children outputs. `transcribe` and `scenes` handlers arrive in steps 5–6; until then those items fail into the DLQ path.
- **`processItem(itemId, messageId)`:**
  1. Claim the item.
  2. Load the request snapshot, asset and account.
  3. Encode to `WORK_DIR`.
  4. Upload to `{slug}/media/{assetId}/…` (stable keys), then delete stale stills under the stills prefix that the new stills don't overwrite.
  5. Run `completeItem` (outside the failure path).
  - **Outdated jobs self-skip.** Before uploading and again before the stale-stills deletion, the encode handler re-reads `asset.version`. If it is greater than `request.assetVersion`, the job stops and settles SKIPPED with `error: "superseded by asset version N"` and its attempt usage through `completeItem`.
  - **Accepted race:** an outdated job that passes the pre-upload check may overwrite a newer version's bytes. This is rare. The metadata stays version-guarded, and the step 7 invalidation plus the next re-encode heal it.
  - **Success is lease-guarded too.** Before `COMPLETE`, the lease is renewed. A lost lease returns `redeliver` and writes nothing.
  - **Lease heartbeat** (`startHeartbeat`, a sequential `setTimeout` chain, so beats never overlap): every `HEARTBEAT_SEC`, `renewLease(itemId, leaseId, progress)` and then `ChangeMessageVisibility(VISIBILITY_EXTENSION_SEC)`. A failed beat is logged and retried on the next tick. A lost lease (`renewLease` returns false) or a CANCELLED request aborts the attempt.
  - **Failure writes are lease-guarded.** The error and the attempt usage are written with the filter `{_id, status: IN_PROGRESS, leaseId}`. A stale worker's failure writes match nothing. The failure is then rethrown, so the message is left for redelivery.
  - **Cancel mid-encode:** `completeItem({ status: "CANCELLED", usage })`, then ack.
  - **Lost lease:** the attempt is aborted and the message is left unacked (`redeliver`). It writes nothing.
  - **SIGTERM with a message in flight:** the encode is aborted, `releaseLease(itemId, leaseId, usage)` sets the item back to QUEUED and pushes the attempt usage (guarded by `leaseId`, and `attempts` is decremented so an interruption does not consume a retry), a fresh copy of the message (same body, attributes and `groupId`) is sent to the same queue, the old message is deleted, and the process exits.
- **Poll loop (Fargate):** `pollSequence(queues)` is a pure helper and it defines the order that is unit-tested.
  - Short-poll `fargate-p1`→`p4` in order. When all are empty, long-poll `p1` for 5 s, which bounds the latency for lower tiers.
  - Handles one item at a time. The long-poll receives the worker's `AbortSignal`, so `SIGTERM` interrupts it.
  - Outcomes: `done` acks (including a busy claim held by a different message), `redeliver` (busy by the same message, lost lease, or a thrown error) leaves the message unacked, and `interrupted` requeues it as above.
  - A poll, ack or visibility error ends the round, logs, backs off 1 s and continues.
  - Idle exit after `WORKER_IDLE_TIMEOUT_SEC` when `IDLE_EXIT=true` (burst tasks).
- **Local worker:** the `helios-worker` compose service (default profile) builds the `test` stage of `worker/Dockerfile`, mounts `local/` read-only so `local/config.json` is the only config source, and runs `npx tsx local/runWorker.ts` with `network_mode: host`, so presigned `localhost:4566` URLs resolve.
- **`Dockerfile`:** `node:22-bookworm-slim` + pinned static ffmpeg/ffprobe (`mwader/static-ffmpeg`). The runtime stage installs only `sharp`, the one package the bundle externalizes, at its lockfile version. The Lambda RIC is added in step 4.

**Core additions.**

- **Config:** `MEDIA_BUCKET`, plus optional `S3_ENDPOINT` (LocalStack, path-style).
- **`storage/`:** an `ObjectStore` interface + S3 implementation: presign get, upload file, list prefix, delete keys.
- **`assets/`:** key builders (`{slug}/media/{assetId}/…`, `{id}` = assetId), plus `pickActiveStill`:
  - a still the user selected maps to the new still with the nearest `timestampSec`;
  - otherwise index 0.
- **`pipeline/claimItem(itemId, messageId, leaseSec)`:** the request is checked first (CANCELLED → the item is marked CANCELLED and the message is acked). Then `findOneAndUpdate` on `{_id, $or: [{status: QUEUED}, {status: BLOCKED, pendingDeps: {$size: 0}}, {status: IN_PROGRESS, heartbeatAt: {$lt: now - leaseSec}}]}`. It sets `IN_PROGRESS`, `messageId`, a new random `leaseId`, `heartbeatAt: now`, and `$min` on `startedAt` (so only the first claim sets it), and `$inc attempts`. An IN_PROGRESS item with a fresh heartbeat returns `{claimed: false, reason: "busy", messageId}` with the holder's messageId. The caller acks when it differs and leaves the message unacked when it is the same, so the message reappears later.
- **`pipeline/lease`:** `renewLease(itemId, leaseId, progress?)` updates `heartbeatAt` (and `progress`) only when the lease matches. `releaseLease(itemId, leaseId, usage?)` sets QUEUED, unsets `leaseId` and `heartbeatAt`, decrements `attempts`, and pushes `usage` when given, all guarded by `leaseId`.
- **`pipeline/recordFailedAttempt`:** pushes the attempt usage and sets `error`, guarded by `{status: IN_PROGRESS, leaseId}`.
- **`pipeline/completeItem`:** idempotent; it is shared later with the DLQ consumer, which passes ERROR/SKIPPED.
  1. Set the terminal status + output + usage + `completedAt` (skipped if the item is already terminal), and `$set outputs.<profile>` (+ `activeStill`) on the asset.
  2. For each dependent:
     - `$pull pendingDeps`;
     - if it is BLOCKED with `pendingDeps` empty, **send to SQS first, then flip to QUEUED**. A crash between the two re-sends on rerun, and claim accepts both BLOCKED-ready and QUEUED, so nothing is lost and duplicates are harmless.
  3. Enqueue the per-item callback message `{type: "item", requestId, itemId}` to `callbacks.fifo` (dedup id `${itemId}:item`).
  4. `$pull pendingItems` on the request. If it is empty and the request is still `IN_PROGRESS`:
     - upsert the job report (unique per request);
     - enqueue the final callback (dedup id `${requestId}:final`);
     - **then** flip the request to COMPLETE (ERROR if any item is ERROR) with `completedAt`.
     - Every step is idempotent, so a crash at any point is repaired by redelivery.
- **Index:** the stuck-fan-out resumer gets an index `{enqueuedAt: 1, createdAt: 1}` with `partialFilterExpression {status: "IN_PROGRESS"}`.
- **Purge:** deferred to step 3 together with its route; the CDN invalidation comes in step 7.

**Tests.**

- **Unit:** golden ffmpeg args per profile, including a capped default and a no-audio video; the progress parser; `pickActiveStill`; claim/complete idempotency (rerun after a crash at each step: no double release, no double finalize, nothing lost).
- **`npm run test:golden`:** runs inside the worker Docker image on generated fixtures. It checks output heights, bitrates within tolerance, faststart (`moov` before `mdat`), still count ≈ duration/3 with timestamps, MP3 params, and image + `image_still`.
- **`npm run local:fixtures`:** generates the fixtures with ffmpeg into `.cache/fixtures` (16:9 1080p, 9:16 720p, 300p, no-audio, image).
- **`test:local` e2e:**
  1. Upload the fixtures to LocalStack S3.
  2. Run `fanOut` (`postProcess` off).
  3. Drain the queues with `processItem`.
  4. Check: the request is COMPLETE, the job report exists, the outputs are in S3 and Mongo, `activeStill` is set, and the callbacks are enqueued.

## Step 3 design: API, auth, admin, request lifecycle

**Request lifecycle (split fan-out).**

- **`createRequest`:** persists the asset (with `sourceMetadata` absent until analyzed) and the request, with status **`ANALYZING`**, `presetSnapshot`, resolved `postProcess`, `mode` and `clientRequestId`. It is idempotent per `(accountId, clientRequestId)`, as before.
- **`launchRequest`:** what fan-out used to do after the insert. It plans, sets `pendingItems`, inserts items, updates the asset, enqueues, sets `enqueuedAt`, and moves the status to `IN_PROGRESS`.
- **`analyzeRequest(requestId)`:** ingests a URL source if needed, ffprobes the source over a presigned URL, stores `sourceMetadata` with display dims (rotation applied), then calls `launchRequest`.
  - Any failure finalizes the request as `ERROR` with `error: { code, message }` and sends the final callback. Codes: `unprocessable_source` (not media, ffprobe failure or timeout, fetch failure), `unsafe_url`, `too_large`, `nothing_to_do` (no non-SKIPPED item), `asset_deleted` (tombstoned asset, non-purge requests). `failAnalyze(requestId)` (called by the analyze DLQ consumer in step 4) sets `analyze_failed`.
- **Analysis is chosen per request** with `analyze: "async" | "sync"`:
  - **`async`:** returns **202** after `createRequest` and enqueues an `analyze` message on the new `analyze` queue. The step-4 Lambda consumes it.
  - **`sync`:** runs `analyzeRequest` inline and returns **201** with the planned items. `analyzeRequest` returns the final request; the API maps `ERROR` with `error.code` in {`unprocessable_source`, `nothing_to_do`, `unsafe_url`, `too_large`, `source_not_found`} to **422**. ffprobe has a hard timeout (`ANALYZE_TIMEOUT_SEC`).
  - `sync` with a `url` source is a `ValidationError` (400). S3 and upload sources are checked with HeadObject at intake; a missing object returns 422 `source_not_found` before any write.
  - URL sources are always async; `sync` + `url` returns 400.
  - Re-encode and post-process on an already-analyzed asset skip analysis and launch directly.
- **The scaler resumer (step 4) covers two cases:**
  - `ANALYZING` older than N → re-enqueue analyze;
  - `IN_PROGRESS` without `enqueuedAt` → `launchRequest`.

**Sources** (`source` is one of the following):

- `{ bucket, key }`: the bucket must be in the account's `sourceBuckets` allowlist.
- `{ uploadKey }`: a Helios upload under `{slug}/uploads/…`.
- `{ url }`, the new URL ingest. It is copied into `{slug}/sources/{assetId}/original` by the analyze step:
  - http/https only;
  - **SSRF guard:** DNS is resolved and private, loopback, link-local, CGNAT, metadata and reserved ranges (v4) are rejected. IPv6 is allow-only: `2000::/3` minus `2001::/23`, `2001:db8::/32`, `2002::/16` (6to4), `3fff::/20`; everything outside `2000::/3` (IPv4-mapped/compatible, NAT64 `64:ff9b::/96` and `64:ff9b:1::/48`, `fc00::/7`, `fe80::/10`, `fec0::/10`, `100::/64`) is rejected. Ports are limited to 80 and 443 unless `STAGE=local`. Connect and response-header and idle-socket timeouts come from `INGEST_TIMEOUT_SEC`. Fetch failures map to `unprocessable_source`. Every redirect hop is re-checked; the connection is pinned to the checked IP;
  - `MAX_INGEST_BYTES` cap;
  - streamed upload, never buffered.

  The same SSRF guard validates `callbackUrl` at the API and again at delivery (step 4).

**Auth.**

- `Authorization: Bearer <key>`.
- **Account keys** are `sk_live_` + 32 random bytes in base62. They are stored as SHA-256 with a unique index, and only a 12-char prefix is kept for display. `lastUsedAt` updates are throttled to once a minute.
- **Admin keys** are `sk_admin_…` in the same collection with `scope: "admin"` and no `accountId`.
- The `Bearer` scheme is matched case-insensitively.
- The first admin key comes from `npm run admin:bootstrap`, a one-time script that refuses to run if an admin key exists. Everything else goes through the Admin API.

**Account API** (account keys). Request and response schemas live in `contracts` and generate OpenAPI at `/docs` + `/openapi.json`.

| Area     | Routes                                                                                                                                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encoding | `POST /encode` (`?dryRun=true` with an S3 or upload source probes without writing, or the body supplies `sourceMetadata`), `POST /assets/:id/re-encode` (`refreshPreset`), `POST /assets/:id/post-process`                                                                                                 |
| Uploads  | `POST /uploads/presigned` (single PUT), `POST /uploads/multipart`, `POST /uploads/multipart/:uploadId/complete` (optional `encode` options = upload-and-encode, status rules below), `DELETE /uploads/multipart/:uploadId`; `POST /files` (raw non-media files under `{slug}/files/…`, icarus replacement) |
| Assets   | `GET /assets` (by `externalId`, cursor), `GET /assets/:id` (outputs with CDN URLs `CDN_BASE_URL/{key}?v={version}`, `postProcess` status, `activeStill`), `PATCH /assets/:id/active-still`, `DELETE /assets/:id` (202, purge), `GET /assets/:id/transcripts`, `GET /assets/:id/scenes`                     |
| Requests | `GET /requests/:id` (items + progress), `DELETE /requests/:id` (cancel; 409 for purge requests), `GET /requests/:id/callbacks`, `POST /requests/:id/callbacks/redeliver` (429 `redeliver_cooldown` inside `REDELIVER_COOLDOWN_SEC`)                                                                        |
| Presets  | per "Preset management API" (account presets; system presets are read and clone only)                                                                                                                                                                                                                      |
| Usage    | `GET /usage?from&to` (reads `usage_daily`; `from <= to`, span at most 366 days)                                                                                                                                                                                                                            |
| Health   | `GET /health` (process liveness only, no auth, no database); `GET /ready` (pings Mongo, no auth, for monitoring)                                                                                                                                                                                           |

`GET /openapi.json` and `GET /docs` require any valid account or admin key. Every route answers 503 `service_unavailable` with `Retry-After` (`RETRY_AFTER_SEC`) when Mongo is unavailable.

**Admin API** (admin keys):

- `POST/GET/PATCH /admin/accounts` (slug, name, `sourceBuckets`, `callbackUrl`, `features`);
- `POST /admin/accounts/:id/keys` (the plaintext key is returned once) and `DELETE /admin/accounts/:id/keys/:keyId` (revoke);
- `POST /admin/accounts/:id/webhook-secret/rotate` (`whsec_…`, returned once);
- `/admin/presets` system preset CRUD;
- `GET /admin/usage`.

**Cancel:**

1. Set the request to `CANCELLED`.
2. Settle every BLOCKED/QUEUED item as CANCELLED through `completeItem`. IN_PROGRESS items abort on their next heartbeat and settle CANCELLED themselves.
3. Write the job report (status CANCELLED) and send the final callback right away. Later settles don't finalize again, because finalize only acts on IN_PROGRESS requests.

**Purge (`DELETE /assets/:id`):**

1. Tombstone the asset (`deletedAt`). Reads return 404 from then on.
2. Cancel in-flight requests.
3. Enqueue a `purge` item on `fargate-p2`. The purge handler throws (retry) while another item of the asset holds a fresh lease. Otherwise it deletes every S3 object under the asset prefix and its ingest copy (`{slug}/sources/{id}/`), plus the upload it owns (the partial unique index on `source.key` means no other asset references it). It then scrubs the asset record (`$unset` outputs, activeStill, externalId, `sourceMetadata.probe`, `source.url`) and the `callback_deliveries` payloads for the asset's requests, deletes transcripts, scene_analyses and pipeline items (except the purge item), and sends the `asset.deleted` callback from the purge request's final callback. `requests`, `job_reports` and `usage_daily` are kept (decision A). The CDN invalidation is added in step 7.
4. Kodak-owned sources are not touched.

**Errors.** A single `HeliosError` hierarchy in `contracts` (`code`, HTTP status, message, details) maps to the JSON body `{ error: { code, message, details, requestId } }`. zod validation failures return 400 `validation_failed`.

**Packages.**

- **`api/`:** Express 5. Thin routers per resource, with logic in core modules (`accounts`, `apiKeys`, `presets`, `requests`, `assets`, `uploads`, `usage`, `callbacks`). Middleware handles auth, validation, error mapping, request logging and correlation ids.
- **Seeds:** `npm run seed:presets` upserts the `generic` system preset.
- **Local:** `npm run local:api`, plus a compose service `helios-api` (host network), and an e2e that drives the full HTTP flow. That flow is: admin creates account + key → upload → encode (sync and async) → drain the queues → GET asset → cancel → purge.
- The Copilot manifest is deferred to step 9.

**Step 3 deviations (as built):**

- Mongo network and server-selection errors map to 503 `service_unavailable` on every route, not only write paths, with `Retry-After` (`RETRY_AFTER_SEC`). Approved by the user on 2026-10-18.
- `RequestView.postProcess` is optional and absent for purge requests. `AssetView.sourceMetadata` omits the raw `probe`.
- `POST /uploads/multipart/{uploadId}/complete` without `encode` returns 200 `{ uploadKey }`. With `encode` it returns `{ uploadKey, request }` and follows the `/encode` status rules: **201** sync, **202** async, **200** repeated `requestId`, and **422** with the sync failure codes (`details: { requestId, assetId }`). Approved by the user on 2026-10-18.
- `sourceMetadata` is accepted only with `dryRun=true` (encode and multipart-complete encode options); otherwise 400.
- Preset routes add `POST /presets/{name}/profiles`, `DELETE /presets/{name}/profiles/{profile}`, `POST /presets/{name}/clone` and `POST /presets/{name}/dry-run`. Admin presets are CRUD only.
- `GET /usage` required `usage_daily.units.llmTokens`, which was never written when an account had no LLM usage. The first increment now seeds it with `$setOnInsert`.
- `limit` on list routes is coerced from the query string (`z.coerce`), since query values arrive as strings.
- Sync analysis is capped at `ANALYZE_TIMEOUT_SEC <= 45`, validated at API startup. The server sets `keepAliveTimeout` to 65s and `headersTimeout` to 66s. The step 9 load balancer must keep its idle timeout at 60s, above the sync budget and below the keep-alive.
- `SIGTERM` and `SIGINT` stop accepting connections, close idle connections and let in-flight requests finish for `SHUTDOWN_DRAIN_SEC`. After that, open connections are closed, then Mongo closes and the process exits.
- Usage ranges are capped at 366 days; the range check runs on both `/usage` routes.
- The OpenAPI document is emitted as 3.0.3 (`OpenApiGeneratorV3`), so the Jest validator (`@readme/openapi-parser`) can load in CommonJS.

## Step 4 design: Lambdas

**`functions/` package (`@helios/functions`).** Thin SQS and schedule handlers over core. Every handler processes one record (`batchSize 1`) and returns `batchItemFailures` on error, so only that message is retried.

- **`analyze`:** `analyze` queue → `analyzeRequest(requestId)`.
- **`dlq`:** one handler for every terminal DLQ:
  - **`fargate-p*-dlq`:** `completeItem` with ERROR (using the item's stored `error`). Optional AI steps (`transcribe`, `scenes`) get SKIPPED instead.
  - **`analyze-dlq`:** `failAnalyze`.
  - **`callbacks-dlq`:** mark the delivery `failed`.
  - The handler is idempotent, because `completeItem` and `failRequest` already are.
- **`callback`:** `callbacks.fifo` → build the payload from stored state, then POST it to the request's `callbackUrl`, or the account's if the request has none.
  - **Delivery:** SSRF-guarded and pinned, with a timeout of `CALLBACK_TIMEOUT_SEC`. Every attempt is recorded in `callback_deliveries`.
  - **Retries:** a non-2xx response or a network error throws, after setting the message visibility to a backoff of 30 s → 2 m → 10 m → 30 m → 2 h. With `maxReceiveCount` 6 the message then goes to `callbacks-dlq`.
  - **Ordering:** FIFO per request, so the item events of one request arrive in order before its final event.
  - No callback URL → the delivery is recorded as `skipped`.
- **`scaler`:** async-invoked after each Fargate enqueue, plus a 1-minute schedule.
  1. Reads the visible backlog of `fargate-p1..p4`.
  2. Lists running tasks (`startedBy=helios-worker`, tags `role=warm|burst`).
  3. Keeps `WARM_WORKERS` warm tasks running (`IDLE_EXIT=false`).
  4. Starts `max(0, min(backlog, MAX_WORKERS) − running)` burst tasks, where backlog is visible plus in-flight messages across `fargate-p1..p4`: on-demand for a p1–p3 backlog, Fargate Spot when the only backlog is p4 and `WORKER_SPOT=true`.
  5. Runs the **fan-out resumer**: `ANALYZING` requests older than `FANOUT_RESUME_AFTER_SEC` are re-enqueued to analyze, and `IN_PROGRESS` requests without `enqueuedAt` go to `launchRequest`. Each resume first claims the request by stamping `resumedAt`, so a request is only acted on when `resumedAt` is absent or older than the cutoff.
  - The scaler and the resumer run independently in one handler: both always run, errors are collected and rethrown together.
  - The scaler is set to reserved concurrency 1 (step 9).
  - The scaler notification after an enqueue is a core `notifyScaler()` that invokes the Lambda asynchronously, throttled per process. `SCALER_NOTIFY=lambda|none` is explicit config: `none` locally, where the compose worker is always on.

**`encoder` Lambda** = the worker image with a Lambda entrypoint (`worker/src/lambda.ts`, run via `aws-lambda-ric` in a `lambda` Dockerfile stage).

- It handles `lambda-p1` and `lambda-ai` records with `processItem`, the same code path as Fargate.
- Visibility is extended through `ChangeMessageVisibility` using the record's receipt handle.
- A timeout or OOM leaves the message in the queue, so redrive moves it to Fargate. The Fargate worker reclaims the item once the lease goes stale.
- `MaximumConcurrency` on the event source mapping is the concurrency cap (step 9 config).

**Callback contract** (`contracts/src/webhooks.ts`; the SDK's `webhooks.verify` returns this typed union):

- **Headers:** `Helios-Signature: t=<unix>,v1=<hex hmac_sha256(whsec, "<t>.<rawBody>")>`, `Helios-Event-Id` (stable per event, for consumer idempotency) and `Helios-Event`.
- **Item events:** `item.completed | item.failed | item.skipped | item.cancelled`, with `{ requestId, assetId, item: { key, kind, profile?, status, error? }, outputs? }`. `outputs` are asset output views with CDN URLs.
- **Request events:** `request.completed | request.failed | request.cancelled` with `{ request view, asset view }`, plus `asset.deleted` for purge requests.
- Consumers verify the signature with a 5-minute tolerance and dedupe on `Helios-Event-Id`. They read terminal state from the payload; it is built from `job_reports` and the asset.
- **Shared views:** the asset, request and output view mappers move from `api/src/views` to core `views/`, shared by the API and the callback payloads.

**Local** (no LocalStack Lambda needed):

- `local/lambdaRunner.ts` emulates the event source mappings. It long-polls `analyze`, `lambda-p1`, `lambda-ai`, `callbacks.fifo` and every DLQ, and invokes the real handlers in-process with SQS-shaped events. An unhandled failure leaves the message, so the real LocalStack redrive applies.
- `local/webhookSink.ts` captures callbacks and verifies the HMAC.
- Compose service `helios-lambdas`.
- **e2e:** the full API flow with real callbacks; a forced Lambda failure redrives to Fargate and completes; a forced permanent failure goes through the DLQ to ERROR with a `request.failed` callback; the resumer picks up an injected stuck request.

**Delivery destinations (added 2026-10-18): webhook or EventBridge.**

- `destination` = `{ type: "webhook", url } | { type: "eventbridge", eventBusArn }`. It replaces `callbackUrl`; the API keeps `callbackUrl` as shorthand for the webhook type.
- **Account default + per-request override:** the request's destination wins.
- **EventBridge delivery:** cross-account `PutEvents` onto the customer's bus. Source `helios.<accountId>`, `DetailType` = event name, `Detail` = the same payload as the webhook body.
  - The customer's bus resource policy grants Helios's AWS account `events:PutEvents`, with the condition `events:source = helios.<accountId>`.
  - IAM authenticates, so there is no HMAC.
  - `FailedEntryCount > 0` is treated like a non-2xx: same backoff, DLQ and delivery log.
- **Validation:** the ARN format is checked (`arn:aws:events:<region>:<account>:event-bus/<name>`), and the account must not be Helios's (`HELIOS_AWS_ACCOUNT_ID`). Both fail with `InvalidEventBusArnError` (400). Webhook URLs must be https outside `STAGE=local`, checked at write and at delivery.
- **Test events:** `POST /destinations/test` (account) and an admin equivalent send a `helios.test` event (sequence 0) to the configured or supplied destination, so a customer can verify their setup. Tests are cooled down per account (`DESTINATION_TEST_COOLDOWN_SEC`, 429 with `Retry-After`). AWS and socket errors map to fixed messages, so raw AWS text or role ARNs never reach responses or stored attempts.
- **Customer self-service:** `GET/PUT /account/destination` sets the account default, so customers need no admin for it.
- **Ordering:** every payload carries `createdAt` and a per-request `sequence`, because EventBridge doesn't guarantee order (the webhook path stays FIFO).
- **Local:** LocalStack EventBridge, with a bus + rule targeting an SQS queue that the e2e reads.
- **SDK:** documents EventBridge rule patterns for each event.
- **Setup documentation (required):**
  - An "EventBridge destination setup" guide in the API docs, as an OpenAPI tag description rendered at `/docs`, and mirrored in the SDK `README.md` and `AGENTS.md`. Step-by-step:
    1. Create or choose a bus.
    2. Attach the resource policy.
    3. Set the destination on the account or request.
    4. Send a test event.
    5. Create rules (with example patterns per event).
    6. Troubleshoot (AccessDenied, wrong region, bus not found).
  - Helper endpoint `GET /destinations/eventbridge/policy?eventBusArn=…` returns the exact resource-policy JSON, with Helios's AWS account id (config `HELIOS_AWS_ACCOUNT_ID`) and the bus ARN filled in, ready to paste.
  - The test-event response explains common failures in plain language.

**Step 4 implementation (deviations and choices, 2026-10-18):**

- **Scaler and resumer are split.** `runScaler()` (core `scaler/`, ECS and SQS only) and `resumeStuckRequests(now)` (core `pipeline/resumeStuck.ts`) are separate. `functions/src/scaler/handler.ts` composes them: scaling first, then the resumer. The local runner calls only `resumeStuckRequests`, so it never needs ECS settings.
- **Config placement.** `SCALER_NOTIFY` (`none` | `lambda`, with `SCALER_FUNCTION_NAME` required for `lambda`), `SCALER_NOTIFY_MIN_INTERVAL_MS` and `FANOUT_RESUME_AFTER_SEC` live in core config, because the enqueue path and the resumer read them. The ECS settings (`ECS_CLUSTER`, `WORKER_TASK_DEFINITION`, `WORKER_SUBNETS`, `WORKER_SECURITY_GROUPS`, `WARM_WORKERS`, `MAX_WORKERS`, `WORKER_SPOT`) live in `scalerConfig()`, loaded only by the scaler. `WARM_WORKERS <= MAX_WORKERS` is validated.
- **`WORKER_CONTAINER_NAME` added** (required). `RunTask` container overrides need the container name to set `IDLE_EXIT`.
- **Fleet shape.** `RunTask` is called once per task. Tasks carry `startedBy=helios-worker` and tag `role`. `DescribeTasks` uses `include: ["TAGS"]`, which is needed to read the role. Warm tasks use `FARGATE` and burst tasks use `FARGATE` or `FARGATE_SPOT`.
- **`planScaling` counts warm workers against `MAX_WORKERS`.** `startWarm = max(0, WARM - running.warm)`. `startBurst = max(0, min(backlog, MAX) - (running + startWarm))`. Spot applies only when the whole backlog is in `fargate-p4`.
- **Notify is a single place.** `enqueueItems` (used by fan-out and by `releaseDependent`) calls `notifyScaler()` when any target is a `fargate-*` queue. `notifyScaler` throttles per process and never throws. A failed or throttled ping is an explicit design choice, not a fallback: the 1-minute schedule covers it.
- **Resumer.** Each kind is bounded to 100 requests per run, oldest first. ANALYZING covers only `analyze: async`. IN_PROGRESS covers only requests without `enqueuedAt`. A failing request is logged and retried on the next run, so one bad request cannot starve the batch. Re-running is safe because enqueued requests drop out of the query.
- **Lambda timeout keeps the lease.** The encoder aborts about 10 s before the timeout. `processItem` gets `releaseLeaseOnAbort: false` for Lambda, so the lease is left to expire, the attempt usage is recorded through `recordFailedAttempt`, and the record is returned as a batch failure. Fargate SIGTERM keeps the release path (`releaseLeaseOnAbort: true`).
- **Batch failures need `ReportBatchItemFailures`** on the event source mapping (step 9). `handler` returns `batchItemFailures` and never throws for item errors. It also turns off `callbackWaitsForEmptyEventLoop`, so the open Mongo connection does not hold the response.
- **Worker config** is a discriminated union on `WORKER_TIER`. The `lambda` tier takes memory from `AWS_LAMBDA_FUNCTION_MEMORY_SIZE` and needs no fargate-only settings. Polling requires `fargateConfig()`.
- **Queue API.** `Queue.changeVisibility` takes only `receiptHandle`, `Queue.approximateBacklog()` is added, and `queueFromArn(arn)` is added. The `FARGATE_QUEUE_NAMES` list is shared by the scaler and the worker.
- **Image.** `worker/Dockerfile` has a `lambda` stage: `node:22-bookworm-slim` (digest pinned), static ffmpeg, and `aws-lambda-ric@4.0.2`, which builds a native addon. Build tools are installed and then purged in the same layer. The entrypoint is the RIC bin, and the image runs as `node`. The RIE is `aws-lambda-rie` v1.37 (x86_64, sha256 `6b1e686e62ab2baf5759c412c4864276ef2a88b094fca53ec070637ccba9b9a5`), mounted by the check and not baked into the image. A malformed-body event returns `batchItemFailures` through the RIE. A valid body reaches `initDb`, and with no Mongo it returns a batch failure.
- **Dependencies.** `@aws-sdk/client-ecs` and `@aws-sdk/client-lambda` are pinned exactly at `3.1152.0`, matching `client-sqs`. `@types/aws-lambda` is pinned at `8.10.164` (dev).

**Not in step 4:** packaging and deployment (serverless or CloudFormation, ECS task definitions), which come in step 9. The image Lambda is step 7.

**Step 4 deviations (as built):**

- `maxReceiveCount` for `callbacks.fifo` is 6 (`queueTopology` and bootstrap). Each of the five backoffs (30 s, 2 m, 10 m, 30 m, 2 h) leads to a retry, and the sixth failed receive moves the message to `callbacks-dlq`.
- Request and asset fields in a payload reflect the asset at delivery time, not at creation time. Sequences can have gaps.
- Dead-letter messages for a missing item, request, or delivery are logged as errors and acknowledged, so a poison message is not redelivered forever.
- `Helios-Event-Id` is the envelope `id`: SHA-256 hex of `${requestId}:${itemId|final}`. Redeliveries keep it.
- `createdAt` is the time of the attempt, and the payload is rebuilt on every attempt. `callback_deliveries.payload` holds the last envelope sent.
- Request events read their status from the job report, because finalize sends the callback before it writes the request status. `job_reports` gains `completedAt` for that purpose.
- `callback_deliveries` gains `status`: `PENDING` until settled, then `DELIVERED`, `FAILED` (DLQ) or `SKIPPED` (no URL).
- An unsafe or private callback address is a retryable failure with the normal backoff, not a permanent failure.
- A dead item settles with its stored `error` only, with no default message.
- Destinations: built as the "Delivery destinations" addendum (EventBridge, the `destination` union, and the per-payload `sequence`). See the 2026-10-18 delivery destinations entry in the decisions log.
- `CALLBACK_TIMEOUT_SEC` is required. It is set in `local/config.json` and in the core test env.
- **2026-10-18 local lambda e2e:** in-process tests share one `WORKER_TIER` (the standalone runner sets `lambda` in `main()`, not `runLambdaSources`). Failure injection uses real conditions: a 5 s `lambda-p1` timeout for redrive, and a missing source key on a non-default preset for the DLQ. The e2e queues use `e2eVisibilityTimeoutSec` (30 s), and they are purged before each run. The callback retry keeps the 30 s schedule (no short-backoff config). The resumer e2e inserts both stuck kinds directly (ANALYZING with no analyze message, and an unlaunched IN_PROGRESS request), with no analyze message in either case.

## Step 5 design: transcription

**AI client (`core/src/ai/`)**, modelled on bella `helpers/gpt.ts`:
- Uses native `fetch` against `OPENAI_BASE_URL` (required config: `https://api.openai.com/v1` in AWS, the local mock server URL locally) with `OPENAI_API_KEY`.
- **Effort tiers:** `ModelEffort` (`low | medium | high`) maps to model ids in **one** file, `core/src/ai/models.ts` (`gpt-6-luna`, `gpt-6-sol`, `gpt-6-astra` as in bella). The transcription model is `whisper-1`.
- **No fallback model chain** (AGENTS.md): a failed call throws, and SQS redelivery retries it.
- **Retries:** an in-process retry only for 429/5xx, timeouts and network failures (`fetch failed`, `ECONNRESET`, `ETIMEDOUT`, `UND_ERR_*`), bounded by `OPENAI_MAX_ATTEMPTS` with exponential backoff. `Retry-After` (seconds or HTTP-date) is capped at `OPENAI_MAX_RETRY_AFTER_SEC`. Waits are abortable. After that, SQS redelivery takes over.
- **Timeouts:** `OPENAI_TIMEOUT_SEC` for chat and `OPENAI_TRANSCRIBE_TIMEOUT_SEC` for `/audio/transcriptions`, each combined with the caller's signal via `AbortSignal.any`.
- **Structured output:** `chatJson({ effort, system, user, schema, schemaName, temperature, meter, signal })` sends `response_format: { type: "json_schema", strict: true }` and parses the whole body as JSON, validated with the matching zod schema. Strict mode needs every property required, so a schema with an optional field is rejected before sending (use `nullable`). No regex scraping.
- **Usage:** the client records into a per-attempt `UsageMeter` as soon as a provider response arrives, before refusal or schema validation. `transcribeAudio` records the response duration as audio seconds. Item usage is read from the meter on success, failure and interrupt (D1 below).
- **Errors:** item errors never carry provider text. An `OpenAIError` is stored as `OpenAI request failed (openai_<status>_<code>)`, and a refusal is stored as a fixed message.

**Transcribe step** (`transcribe` item; `lambda-ai` for short sources, `fargate-p3` otherwise; worker handler registry kind `transcribe`):
1. **Extract audio:**
   - Run ffmpeg on the (guarded) source → mono, 16 kHz, `libmp3lame` at 32 kbps (≈14 MB/hour).
   - A source without an audio stream was already SKIPPED at fan-out.
2. **Chunk** when the file exceeds `TRANSCRIBE_MAX_UPLOAD_BYTES` (config, below the 25 MB provider limit). The cut is by time:
   - `TRANSCRIBE_CHUNK_SEC` windows, each extended by `TRANSCRIBE_OVERLAP_SEC`.
   - Each chunk is transcribed with `whisper-1`, `response_format=verbose_json`, `timestamp_granularities[]=segment`, plus the request's `language` hint when given.
   - **Merge:** offset each chunk's segments by the chunk start, and keep a segment only if its midpoint falls inside the chunk's own non-overlapping window `[start, nextStart)`. Every moment then belongs to exactly one chunk: there are no duplicates, and no segment is lost at a boundary.
3. **Language:** Whisper's detected language name is mapped to a code with a fixed table (`javanese` → `jv`). An unknown name throws a typed error; it does not silently become English. A request hint is validated at intake against the table's codes (`ValidationError`). With no hint, chunk 0's detected code is the hint for the later chunks, so every chunk of one source uses the same language.
4. **English track:** when the native language ≠ `en` and `translateToEnglish` is set (the default):
   - The native segments are translated with `chatJson`, effort tier `TRANSLATE_EFFORT` (config), in batches of `TRANSLATE_BATCH_SEGMENTS`.
   - Schema: `{ segments: [{ index, text }] }`. The indices must exactly match the input batch, otherwise a typed error is raised and the attempt retries.
   - Start and end times are copied from the native segments, so both tracks align exactly.
5. **Store:**
   - Upsert into `transcripts` on the unique `{assetId, language, isTranslation}` key, so reruns never duplicate (partnrup's duplicate-row bug). Each write bumps `revision` (`$inc`). URLs carry `?v=<revision>`.
   - Fields: `{ segments: [{start,end,text}], text, durationSec, model, createdAt }`.
   - Write `{slug}/media/{assetId}/transcript/{lang}.{srt|vtt|txt}` for the native track and `transcript/{lang}.translated.{srt|vtt|txt}` for the translation (`en.translated.*`). Native English never also has a translation.
   - After all tracks are stored, rows and files of this asset not in this output are removed (`removeStaleTranscripts`), so a rerun with a different detected language leaves no stale track.
   - Merge boundaries are a heuristic, since Whisper segments each chunk differently. After midpoint selection, each segment's end is clamped to the next start, and a segment left with no duration is dropped. The e2e asserts non-overlapping, ordered cues.
6. **Usage:** the attempt's usage entry carries `audioSec` (transcription seconds) and one `llm` entry per chat call → resource units `transcriptionAudioSeconds` + `llmTokens`.
7. **Errors** are retried through SQS (`maxReceiveCount` 3). The DLQ consumer marks the step SKIPPED (optional AI step), so `scenes` proceeds stills-only. The item's `error` is stored.

**Caption utilities** (`core/src/captions/`):
- Pure `toSrt`, `toVtt`, `toText`, `parseSrt`, `parseVtt`. Index lines are positional, so a caption whose text is a number such as `2024` or `0` is preserved, which fixes partnrup's `_splitSrt` bug.
- Timestamps use millisecond floor rounding.
- Round-trip tests, including multi-line text, numeric-only lines, an empty text segment and hours > 99.

**API:**
- `GET /assets/:id/transcripts` returns `[{ language, isTranslation, segments, text, durationSec, model, urls: { srt, vtt, txt } }]`.
- `GET /assets/:id` includes `postProcess.transcribe.status`.
- Item callbacks for `transcribe` carry the transcript summary (languages + URLs).

**Local testing:**
- **Default:** `local/openaiMock.ts`, an HTTP server that implements `/audio/transcriptions` (canned `verbose_json` derived from the chunk duration, with a configurable language) and `/chat/completions` (echoes the translated text deterministically). The e2e runs the full chunk → merge → translate → store path with no network.
- **Opt-in real API:** `npm run test:openai` runs only when `OPENAI_API_KEY` is set in the root `.env`. It uses a short speech fixture (TTS-generated when a TTS tool is available; otherwise a fixture path given in `local/config.json`) and checks native + English output and timings.

**Deviations as built (2026-10-18).**

- **Usage (D1):** every attempt meters AI usage, including failed and interrupted attempts. The client records each provider response into the attempt's `UsageMeter` before validation, so calls made before a failure are kept. Each attempt is still one usage entry.
- **No cross-attempt reuse (D3):** a retried item re-extracts and re-transcribes its audio. The native track is not reused from an earlier attempt.
- **Chunk windows:** a window is `[keepFrom - overlap, keepUntil + overlap]`, so each side has context. Only the merge's keep range decides ownership.
- **Copy cuts:** `-c copy` is aligned to mp3 frames, so a cut can be about 0.13 s longer than planned. The merge offset uses the planned start, so this stays within one frame.
- **Language:** `transcribeAudio` returns the ISO-639-1 code, so the handler does not map names again. The first chunk's detected language is the stored language. With no request hint, it is also the hint for the later chunks.
- **Language codes:** `haw` and `yue` are ISO 639-2/3 codes that Whisper uses. They pass intake validation, but the OpenAI API may reject them as hints, since it documents ISO-639-1.
- **Translation:** a schema or index mismatch throws `TranslationMismatchError`, and SQS redelivers the whole item. The retry re-transcribes all chunks.
- **Local mock:** the detected language is `openai.mockLanguage` unless a request hint is sent, in which case the mock reports that hint's name. Segments start at a lead-in offset, not at 0. Forced failures are per endpoint, set by `setFailures`.
- **Local mock runner:** `helios-openai-mock` is its own compose service (`local/openaiMock.ts`, host network, `openai.mockPort`). `runWorker` and `lambdaRunner` no longer start a mock. The e2e tests start their own mock on `openai.e2eMockPort`, and `applyLocalEnv` points `OPENAI_BASE_URL` there when run with `e2e: true`.
- **Per-suite scripts (D2):** `npm run test:local:<name>` runs one e2e file (`fanOut`, `worker`, `lifecycle`, `api`, `eventbridge`, `lambdas`, `transcribe`). `test:local` remains the full run.
- **Local e2e:** the encode in `transcribe.e2e.ts` uses `mp4_360`, `stills` and `audio` only, so the 200 s source finishes inside the 180 s drain deadline. The transcribe item is unchanged.
- **Read API:** `GET /assets/:id/transcripts` returns `urls` (`?v=<revision>`) per transcript. The e2e checks the S3 keys and Mongo documents directly.
- **Callbacks:** item callbacks for `transcribe` carry `transcripts: [{language, isTranslation, urls}]` on the item event data.
- **Startup validation:** the worker validates its config and `aiConfig()` at startup (`main`), and `lambdaRunner` does the same. The Lambda handler validates on each invocation, because `lambdaRunner` imports the handler before it applies the local environment.

## Step 5b: multi-language translations (added 2026-10-19)
**API shape:** `postProcess.transcribe = boolean | { language?: ISO hint for the source, translations?: string[] (extra ISO targets), english?: boolean (default true), retranscribe?: boolean }`.
- **Native track:**
  - The source language is auto-detected unless `language` is given.
  - English is added automatically when the native language ≠ `en`, unless `english: false`.
  - `translations` are extra targets on top of that. They are deduped, the native language is dropped from the set, and every code is validated against the language table.
  - When the native language is `en`, the extras are translated from English.
- **Translations** always come from the native segments, so the timings stay identical.
- **Later requests are additive.** `POST /assets/:id/post-process` with only new `translations`:
  - reuses the stored native transcript (no audio re-transcription, no audio usage);
  - translates only the languages that are missing;
  - keeps the existing translations.
- **`retranscribe: true`** produces a fresh native transcript and regenerates every existing translation from it, plus any new ones. Stale rows and keys are removed only in this case, or on encode/re-encode.
- **Re-encode / encode** of a source replaces the whole transcript set with the requested one.
- **Execution:**
  - When the native track is reused, `transcribe` items run on the AI tiers as before and skip the extract → Whisper stage.
  - The item output and callback list every language produced or kept.
  - `scenes` is unaffected by translate-only requests.
- **Storage:**
  - Native: `transcript/{lang}.*`; translations: `transcript/{lang}.translated.*`.
  - Unique `{assetId, language, isTranslation}`.
  - Each transcript has its own `revision` for CDN cache-busting.

## Local development & testing

Goal: test as much as possible on the local server with Docker + LocalStack before any AWS deploy.

**Infra (decided 2026-10-17).**

- **Default:** reuse the already-running shared `localstack` (:4566, pinned `localstack/localstack:4.14`) and `mongodb` (:27017, `rs0`).
  - The `helios` DB sits beside bella's, mirroring prod.
  - Kodak-style local buckets are in the same S3.
- **`docker compose --profile standalone up`:** Helios's own LocalStack (:4666) + `mongodb-atlas-local` (:27117). Used for CI and Phase 2 vector search.
- **`local/config.json`** (committed, editable) is the single place for local infra settings:
  - the AWS endpoint/region and LocalStack credentials (`awsAccessKeyId` / `awsSecretAccessKey`, both `test`), the Mongo URI, queue prefixes (dev + e2e), bucket names and service ports;
  - switching between shared and standalone infra is a matter of editing this file.
  - `local/loadConfig.ts` validates it with zod and maps it to the env vars the services read.
  - Secrets (`OPENAI_API_KEY`, etc.) stay in the git-ignored root `.env`.

**Queue topology as code.**

- `core/src/queue/topology.ts` is the single definition of every queue, its DLQ/redrive target and its `maxReceiveCount`:
  - `lambda-p1`→`fargate-p1` (2)
  - `lambda-ai`→`fargate-p3` (2)
  - `fargate-p1..p4`→own DLQ (3)
  - the callback FIFO + DLQ
- It is used by `npm run local:bootstrap` (creates queues + buckets in LocalStack, idempotent) and later by serverless config generation/tests, so local and AWS can't drift.

**Local runners (no LocalStack Pro needed).**

- **`local/lambdaRunner.ts`:** emulates SQS event-source mappings.
  - Long-polls `lambda-*` queues and invokes the real Lambda handlers in-process with an SQS event.
  - A thrown error or timeout leaves the message undeleted, so the real LocalStack redrive moves it to Fargate queues exactly as in AWS.
  - The same pattern serves the `callback`, `dlq` and `analyze` functions.
- **Compose services added per build step:**
  - `helios-worker` (the real worker image, Fargate poll loop);
  - `helios-api`;
  - `helios-lambdas` (lambdaRunner);
  - `helios-img` (a local Express wrapper emulating the CloudFront `/img/*` origin group: S3 `resize_cache/` first, then the image handler).
- **`local/webhookSink.ts`:** captures callbacks, verifies HMAC, and exposes them to e2e tests.
- **Fixtures:** `npm run local:fixtures` generates the test media with ffmpeg (`testsrc`/`sine`), so no binaries are committed: 16:9 1080p, 9:16 720p, 300p, no-audio, long, and image.

**Local runners (as built, 2026-10-18).**

- `local/lambdaRunner.ts` (`npm run local:lambdas`, compose `helios-lambdas`) emulates the SQS event source mappings for the analyze, lambda-p1/lambda-ai, callbacks and every DLQ queue.
  - It calls the real functions and worker handlers with SQS-shaped records and a fake Lambda context, and it runs the resumer loop.
  - It deletes a message only on success; the LocalStack redrive does the rest.
  - It does not emulate Lambda scaling, ECS, EventBridge rules or the scaler.
- `local/webhookSink.ts` is the shared webhook receiver for the e2e tests. It verifies the signature against the account secret and can force HTTP statuses.
- The `worker/Dockerfile` test stage copies `functions`, so the compose service needs no `./functions` mount.

**Test layers.**

- **`npm test`:** unit + mongodb-memory-server. No Docker needed.
- **`npm run test:local`:** a jest `*.e2e.ts` project against LocalStack + local Mongo, with `QUEUE_PREFIX=helios-e2e`. Each run uses a unique account and cleans up its own docs.
  - **Step 1:** fan-out lands messages in real queues with `MessageGroupId`/attributes; redrive `lambda-p1` → `fargate-p1` after 2 receives.
  - **Step 2+:** the worker encodes fixtures from local S3.
  - **Step 3+:** the full `POST /encode` → callbacks → assets flow.
  - **Steps 5–6:** run AI steps against real OpenAI only when `OPENAI_API_KEY` is set in `.env`.

## Verification

- **Unit:**
  - Fan-out/filtering/defaults, `pendingDeps` release incl. `skipped` transcribe.
  - Completion handler idempotency: rerun after a simulated crash at each step leaves no duplicate enqueue and no double finalize.
  - DLQ consumer, tiered poll order.
  - Key hashing, SSRF, HMAC, ffmpeg arg snapshots.
  - Transcript chunk-merge offsets, SRT/VTT round-trip.
  - Still sampling/windowing + scene stitching.
  - LLM client with a mocked HTTP layer and schema validation.
  - Kill leftover jest/mongo-memory processes after runs.
- **Step 1 unit tests:**
  - **`core/test/planItems.test.ts`:** pure unit tests for:
    - the smart filter on 1080p, 720p and 300p sources;
    - the default profile capped on a 300p source;
    - image input;
    - `postProcess` defaults and overrides;
    - every row of the routing table at the threshold edges;
    - the `reencode` → p4 and `postProcess` modes;
    - the no-audio case → transcribe SKIPPED and scenes with deps on the default only.
  - **`core/test/fanOut.test.ts`:** uses a `MongoMemoryReplSet` helper modeled on bella's `tests/setup/parseTestServer.ts`, with `SqsQueue` mocked. It checks:
    - `pendingItems` is correct;
    - `dependents` / `pendingDeps` are consistent;
    - only QUEUED items are enqueued, each to the correct queue with `MessageGroupId = accountId`;
    - a repeated client `requestId` returns the same request, with no second insert or enqueue;
    - re-encode uses the stored snapshot unless `refreshPreset` is set;
    - `ensureIndexes` creates the TTL and unique indexes.
- **Routing:** unit tests for the threshold routing table. On dev, a Lambda run with a source forced past the timeout lands on `fargate-p1` and completes. Check both `WARM_WORKERS=0` and `WARM_WORKERS=1` behavior (warm task never idle-exits; burst tasks do).
- **Worker in Docker:** fixtures (16:9 1080p, 9:16 720p, 300p, no-audio, non-English speech, >25 MB-audio long video, image). Check heights, bitrates, faststart, still count ≈ duration/3, transcript + English translation, scenes JSON valid.
- **LocalStack** (`npm run test:local`, see "Local development & testing"): Kodak-style source → `/encode` with `postProcess` variants (both, transcribe only, none) → per-item callbacks + final → assets/transcripts/scenes correct.
- **Dev deploy:**
  - Real Kodak dev videos.
  - Image `c_pad` variant: first request served by the Lambda, second from the S3 cache, and a >1 MB variant.
  - Kill a worker mid-encode → the item is redelivered and completes.
  - Prompt quality review against partnrup outputs.
  - Novel preset vs ~50 Cloudinary originals.
- **Commands (step 1):** `npm test` passes and `tsc --noEmit` is clean. Afterwards, kill any leftover jest / `mongod` (mongo-memory) processes and confirm none remain with `pgrep -fa "jest|mongod"`.
- **Commit (step 1):** on a `feat/scaffold-core` branch, then check in before step 2.

## Implementation decisions log

- **2026-10-18 (step 5 transcription):**
  - Audio is extracted with `-vn -ac 1 -ar 16000 -c:a libmp3lame -b:a 32k`. Chunks are planned by time and stream-copied. The merge keeps a segment only if its midpoint is in `[keepFrom, keepUntil)`, so no boundary segment is duplicated or lost.
  - `TRANSCRIBE_MAX_UPLOAD_BYTES` must be below 25 MiB. `TRANSCRIBE_OVERLAP_SEC` must be below `TRANSCRIBE_CHUNK_SEC`.
  - English translation is produced in batches of `TRANSLATE_BATCH_SEGMENTS` at effort `TRANSLATE_EFFORT`, with temperature 0.2. Start and end times come from the native track.
  - Usage is one entry per attempt (audio seconds + an `llm` array), so attempts are not double counted. Every attempt meters what it used, including failed and interrupted ones (D1).
  - The local OpenAI mock is the `helios-openai-mock` compose service. The e2e tests start their own mock on `openai.e2eMockPort`.
  - `TRANSCRIBE_MAX_UPLOAD_BYTES` must hold one chunk window: `(TRANSCRIBE_CHUNK_SEC + 2 * TRANSCRIBE_OVERLAP_SEC) * 4000` bytes must be below it (32 kbps audio).
  - Transcript files use stable keys (`transcript/{lang}.*` native, `transcript/{lang}.translated.*` translation). Stale tracks are deleted after a successful run. Each write bumps `revision`, and URLs use `?v=<revision>`, not the asset version.
  - Intake validates the transcribe language hint against the language table (`ValidationError`). OpenAI failures are stored as sanitized codes, never provider text.
  - Whisper's `javanese` maps to `jv`, not `jw`.
  - `OPENAI_TRANSCRIBE_TIMEOUT_SEC`, `OPENAI_MAX_RETRY_AFTER_SEC` and `OPENAI_TIMEOUT_SEC` are required, with no defaults.
  - Dead-letter transcribe items settle SKIPPED, which matches the AI section above.
  - `npm run test:openai` is opt-in. It skips unless `OPENAI_API_KEY` is in the root `.env`, and it needs a Spanish fixture from espeak or `openai.realApiFixturePath`.
- **2026-10-18 (step 4 review fixes and user decisions):**
  - A. EventBridge `Source` is `helios.<accountId>`. The policy helper takes the authenticated account and adds `Condition: StringEquals events:source`. The CLI shorthand cannot express that condition, so the command is `put-permission --policy` with a merged policy (`--policy` replaces the whole bus policy; the guide shows the merge). The guide rules use the per-account source.
  - B. Scaler target is `max(0, min(visible + in-flight across fargate-p1..p4, MAX_WORKERS) - running)`. The spot rule is unchanged.
  - C. Webhook URLs must be https outside `STAGE=local`. The check runs at write (`assertDestination`) and at delivery (`postWebhook`), because the contract cannot see `STAGE`.
  - D. A redelivery keeps the same `Helios-Event-Id`. The webhooks guide says this is for events the endpoint never received.
  - Bus ARNs in Helios's own account are rejected with `InvalidEventBusArnError` (400) on writes and on test events. The regex check lives only in `parseEventBusArn`.
  - Deviation: locally `HELIOS_AWS_ACCOUNT_ID` is `111111111111`, so the own-account check is meaningful. The local customer bus is in LocalStack's `000000000000`.
  - `callbacks.fifo` `maxReceiveCount` is 6, in the topology and the bootstrap.
  - The encoder Lambda and every functions handler reject a batch that is not exactly one record (`runRecords` and the encoder share the guard).
  - `safePost` destroys the response instead of draining it.
  - The resumer claims each request by stamping `resumedAt`, and it acts only when `resumedAt` is absent or older than the cutoff. Indexes support the claim.
  - The scaler handler runs the scaler and the resumer independently: both always run, errors are collected, and an `AggregateError` is thrown after both finish. It uses `connectOnce`.
  - Standalone LocalStack has `SERVICES: s3,sqs,events`. The bootstrap EventBridge setup stays.
  - Customers set their default destination with `GET/PUT /account/destination`. Admins keep `PATCH /admin/accounts/:id`.
  - `helios.test` is a member of `WebhookEventSchema` with sequence 0. Real events start at 1, and gaps are possible.
  - The destination test endpoints have a per-account cooldown (`DESTINATION_TEST_COOLDOWN_SEC`, 429 with `Retry-After`). AWS and socket errors map to fixed messages in responses and in stored attempts. Distinct codes stay for the caller's own destination only.
  - Dead-letter messages for a missing item, request or delivery are logged as errors and acknowledged.
  - `CallbackDeliveryView` exposes `status`, and `destinationType` is updated on every attempt.
  - Quality: one `queueNameFromArn` (core), `@types/aws-lambda` types in functions, one optional-kinds list (`OPTIONAL_ITEM_KINDS`), the local runner uses the core logger and caches queue URLs, bootstrap takes the visibility timeout as a required argument, and every OpenAPI operation has a tag.
  - Approximate backlog counts visible plus not-visible messages (`ApproximateNumberOfMessagesNotVisible`).
  - **Step 9 checks:** set the scaler's reserved concurrency to 1. Verify on real AWS that a `lambda-p1` → `fargate-p1` redrive receives the expected `ApproximateReceiveCount` on the first Fargate receive.

- **2026-10-18 (step 3 API review, user decisions):**
  - A. Mongo unavailability answers 503 on every route with `Retry-After` (`RETRY_AFTER_SEC`, required). Approved as the deviation above.
  - B. `/docs` and `/openapi.json` require any valid account or admin key.
  - C. `/health` is process liveness only. `/ready` pings Mongo with no auth.
  - D. Upload-and-encode (multipart complete with `encode`) uses the `/encode` status rules: 201 sync, 202 async, 200 repeat, 422 sync failure. The same reply mapping is shared.
  - E. Sync analysis is capped at `ANALYZE_TIMEOUT_SEC <= 45` for the API process. `keepAliveTimeout` is 65s and `headersTimeout` is 66s. ALB idle timeout is 60s (step 9).
  - Redelivery is throttled per request by `REDELIVER_COOLDOWN_SEC` (required), stored as `lastRedeliverAt`. A repeat inside the cooldown answers 429 `redeliver_cooldown` with `Retry-After`.
  - Cancelling a purge request is a 409 `purge_not_cancellable`.
  - Finalize records units for every terminal item after the job report exists, so an item that settles between the read and the report write is counted once.
  - `pipeline_items` carry a stored `key`. The API no longer slices `_id`.
  - Driver errors are classified with `instanceof` (`MongoNetworkError`, `MongoServerSelectionError`, `MongoNotConnectedError`, `MongoTopologyClosedError`). Core re-exports the driver classes so tests share one `mongodb` copy with core.
  - Build outputs are `dist/api/main.js` and `dist/worker/main.js`.
- **2026-10-17:** Mongo layer: raw `mongodb` v6 driver + zod.
- **2026-10-17:** Repo: npm workspaces monorepo (`contracts`, `core`, `api`, `functions`, `worker`, `sdk`).
- **2026-10-17:** TypeScript 6.0 (ts-jest doesn't support TS 7 yet).
- **2026-10-17:** Node 22.
- **2026-10-17:** CommonJS.
- **2026-10-17:** String UUID `_id` for all collections.
- **2026-10-17:** `pipeline_items` TTL: 30 days after `completedAt`.
- **2026-10-17:** Dependency tracking uses id sets, not counters. Items hold `pendingDeps: [ids]`, requests hold `pendingItems: [ids]`. Replays are idempotent, and a duplicate SQS send is acceptable.
- **2026-10-17:** Request `_id` is always a server UUID. The per-account unique key is `{accountId, clientRequestId}`, where `clientRequestId` is the API's `requestId`. A repeat with a different asset or mode throws `RequestIdConflictError`, and a repeat of a request that was already enqueued or CANCELLED returns it without writes. Otherwise fan-out resumes: it plans once from the stored snapshot, inserts missing items, and enqueues only the items whose DB status is QUEUED.
- **2026-10-17:** Zero-work requests (no non-SKIPPED item) finalize as ERROR with code `nothing_to_do` (see the 2026-10-18 entries). The API maps it to 422 in sync mode.
- **2026-10-17:** Silent video gets no MP3 item, and its transcribe item is SKIPPED. Images get no transcribe item. A dedicated `image_still` profile (stills, `maxCount: 1`) is a child of `image`.
- **2026-10-17:** Client idempotency field renamed `requestId` → `clientRequestId` on the request doc. `requestId` on items, message attributes and logs always means `requests._id`. `FanOutInput` keeps the public name `requestId`.
- **2026-10-17:** `requests.assetVersion` is stored at fan-out and applied to the asset with `$max`, so a resumed re-encode bumps the version once.
- **2026-10-17:** Preset refinements: a child profile must be `stills` and not default; every default profile must be `video` or `image`.
- **2026-10-17:** LocalStack pinned to `localstack/localstack:4.14` (compose standalone profile and the shared instance).
- **2026-10-17:** `SQS_FAIR_QUEUES` config flag. The shared LocalStack was upgraded 4.5 → 4.14 (`localstack:4`; `latest` now requires a paid auth token), so it is `true` locally and on AWS.
- **2026-10-17:** stuck fan-outs are resumed by the scaler (1-minute schedule, `FANOUT_RESUME_AFTER_SEC`); the API returns 202 once the request is persisted and 503 only when it cannot be persisted. Build in step 4 (scaler); the index lands with the step 2 model work.
- **2026-10-17:** Required vs optional dependency edges. Scenes requires the default encode item and treats transcribe as optional. A required failure cascades SKIPPED with an error that names the dependency. An optional failure releases the dependent.
- **2026-10-17:** Completion settles first, then hands off from the stored status and output. Late or losing completions change nothing, and the asset write is guarded by the request's `assetVersion`.
- **2026-10-17:** Terminal items are rerun through claim (`reason: terminal`) so a crashed handoff is repaired on redelivery.
- **2026-10-17:** Usage is recorded per attempt and per compute tier. The job report stores a `UsageSummary` with no zero-filled metrics.
- **2026-10-17:** Cost is stored as resource units, not dollars. Helios never stores currency or rates, and prices are applied outside Helios. `usage_daily` is incremented exactly once per request, guarded by `unitsRecordedAt`.
- **2026-10-17:** The worker runs as the `helios-worker` compose service with host networking, so presigned localhost URLs resolve.
- **2026-10-18:** Stable output keys, no version history. Re-encodes overwrite `{slug}/media/{assetId}/…` in place, and stale stills are deleted after the new stills upload. Versioned keys (`v{n}/`) were considered and rejected. Instead, an outdated job checks the asset version before it uploads and before it deletes, and it self-skips as SKIPPED. A CloudFront invalidation after re-encode is planned for step 7.
- **2026-10-18:** Heartbeat lease. Items carry `leaseId` and `heartbeatAt`. A fresh lease is `busy`. A duplicate delivery from a different message is acked, and the same message is left unacked. A stale lease is reclaimed with a new `leaseId`. A lost lease aborts the attempt and writes nothing. Failure and success writes are guarded by the lease.
- **2026-10-18:** Interruptions do not consume retries. On SIGTERM the lease is released (`attempts` decremented) with the attempt usage metered, and a fresh copy of the message is sent before the old one is deleted. Superseded SKIPPED attempts are metered too.
- **2026-10-18:** `VISIBILITY_EXTENSION_SEC` must be at least `LEASE_SEC` (worker config check).
- **2026-10-18:** The worker's handler registry is keyed by item kind. `encode` dispatches per profile type inside the handler.
- **2026-10-18:** A stills template without a directory is rejected by `stillsPrefix`, so stale-still cleanup can never reach the asset root.
- **2026-10-18:** Callback consumers must be idempotent. Terminal reruns re-send callbacks beyond the FIFO dedup window.
- **2026-10-18:** Accepted race: an outdated job that passes the pre-upload version check may overwrite a newer version's bytes. Metadata stays version-guarded, and the step 7 invalidation plus the next re-encode heal the bytes.
- **2026-10-18:** The runtime image installs only `sharp` (the externalized package) at its lockfile version. Everything else is bundled into `dist/main.js`.
- **2026-10-18:** `usage_daily` is incremented in one transaction together with `unitsRecordedAt`, and buckets use the UTC day of the finalize time. LLM model names are stored as `mongoKey`.
- **2026-10-18:** SourceMetadata dimensions are display dimensions. Images are oriented with EXIF `rotate()`.
- **2026-10-17:** Known limit: two concurrent redeliveries of the same final item can both finalize. Callback dedup ids and idempotent consumers absorb this. Distinct final completions finalize exactly once.
- **2026-10-18:**
  - Analysis is chosen per request (`analyze: sync | async`). Requests start as `ANALYZING`, and fan-out is split into `createRequest` and `launchRequest`.
  - URL ingest is in Phase 1, with an SSRF guard, and is always async.
  - The Admin API uses admin-scoped keys; only the first admin key comes from a one-time bootstrap script.
- **2026-10-18 (step 3 review fixes):**
  - Decision A (purge): keep `requests`, `job_reports` and `usage_daily`. Scrub PII from the asset record and callback payloads, and delete the bound upload. Purge waits (throws) while a fresh-lease item exists.
  - Decision C (late cancel usage): an item that settles after its request finalized has its resource units added to `job_reports.resourceUnits` and `usage_daily` exactly once, guarded by `unitsRecordedItems`. This runs in one transaction. The first finalizer inserts the report (`$setOnInsert`), so its status and items win.
  - Decision D (STAGE and SSRF allow rule): config requires `STAGE` (local|dev|prod). `SSRF_ALLOWED_HOSTS` must be empty unless `STAGE=local`, which is a startup error. Ports are 80/443 only, except in local stage. `http:` is allowed in ffmpeg and ffprobe only in local stage.
  - Protocol and demuxer whitelists: ffprobe and ffmpeg run with `-protocol_whitelist https,tls,tcp[,http]` and `-format_whitelist` of the container demuxers (mov, mp4, m4a, 3gp, 3g2, mj2, matroska, webm, avi, mpegts, flv, mpeg, ogg, wav, mp3, aac, flac, image2, png_pipe, jpeg_pipe, webp_pipe, gif). The list was checked against host ffmpeg 4.4. Playlist and concat demuxers and `file:` are rejected.
  - Ingest stores `application/octet-stream`. The probe JSON drops `format.filename`. ffprobe stderr is captured into the error, with the source URL redacted.
  - A request is `ERROR` with a `{code, message}` error. A repeat of an ANALYZING async request re-enqueues analyze (idempotent), and launches once the asset is analyzed.
  - Upload keys bind to one asset via a partial unique index on `media_assets.source.key` (type upload).
- **2026-10-18 (step 4 Lambdas and scaler):**
  - The scaler is split into `runScaler()` (ECS) and `resumeStuckRequests(now)`. The handler composes them, and the local runner calls only the resumer, so local never needs ECS settings.
  - `SCALER_NOTIFY` is `none` or `lambda`, and `lambda` requires `SCALER_FUNCTION_NAME`. Notify is throttled per process and never throws. The 1-minute schedule covers suppressed or failed pings.
  - Scaler ECS settings are validated only in the scaler, and they add `WORKER_CONTAINER_NAME`.
  - Stuck-request resumer: 100 per kind per run, and a failure is isolated to its request.
  - The encoder Lambda never releases the lease on a timeout. It records the usage and returns the batch failure, so the lease expires and SQS redrives the message after `maxReceiveCount`.
  - `WORKER_TIER=lambda` reads memory from `AWS_LAMBDA_FUNCTION_MEMORY_SIZE` and needs no fargate-only settings.
  - `aws-lambda-ric` 4.0.2 (published 2026-03-09), `aws-lambda-rie` v1.37 (published 2026-08-31), and `@aws-sdk/client-ecs` and `client-lambda` 3.1152.0 are all at least two weeks old.
- **2026-10-18 (step 3 API libraries):**
  - Express 5.2.1, pinned. 5.3.0 was published 2026-10-09, less than two weeks before this entry.
  - `@asteasolutions/zod-to-openapi` 9.1.0, the zod 4 peer. Schemas stay in `contracts`, and the same endpoint specs drive routing, validation and OpenAPI.
  - `swagger-ui-express` 5.0.1 serves `/docs`, self-hosted with no CDN. It is external in the esbuild bundle and installed at its pinned version in the runtime image, like `sharp`.
  - Tests: `supertest` 7.2.2 with `@types/supertest` 7.2.1. OpenAPI validation uses `@readme/openapi-parser` 2.7.0, because `@apidevtools/swagger-parser` 13 is ESM-only under Jest 30.
  - `@types/express` 5.0.6 and `@types/swagger-ui-express` 4.1.8.
  - The API image is built from `api/Dockerfile`, pinned to the same base and ffmpeg digests as the worker. The runtime carries only `ffprobe`.
- **2026-10-18:** callback destinations are webhook or EventBridge (cross-account PutEvents to the customer's bus), configured as an account default with a per-request override. The Stripe-style partner event source was rejected as unnecessary.
- **2026-10-18 (step 4 Lambdas):**
  - Callback signature is `t=<unix>,v1=<hex HMAC-SHA256>` over `<t>.<rawBody>`. Verification uses a 300 s tolerance and `timingSafeEqual`.
  - Event ids are deterministic per request event or item event, so consumers dedupe redeliveries.
  - Callback retries back off 30 s, 2 m, 10 m, 30 m and 2 h. A receive past the fifth reuses the 2 h step.
  - Dead-letter items settle ERROR, or SKIPPED for `transcribe` and `scenes`. Failure detail comes only from the stored item error.
- **2026-10-18 (delivery destinations addendum, built):**
  - `destination` is `{type: "webhook", url} | {type: "eventbridge", eventBusArn}`. `callbackUrl` is shorthand for a webhook destination. Sending both is a 400. Account PATCH accepts `destination: null` to clear it.
  - Request destination overrides the account default. A missing destination settles the delivery SKIPPED.
  - `sequence` is assigned atomically with `requests.nextSequence` when a callback message is created. Redeliveries keep the stored sequence, and a manual redeliver gets a new one.
  - Senders are dispatched by a `sendTo` switch in `core/src/callbacks/senders/`. `PutEvents` sends no `Resources`. Payloads of 256 KB or more fail at once with no retry.
  - `POST /destinations/test` and `POST /admin/accounts/:id/destinations/test` send a synchronous `helios.test` event that writes no delivery row. `GET /destinations/eventbridge/policy` returns `{ policy, command }`.
  - Guide markdown lives once in `docs/guides/*.md`. It is bundled with the esbuild text loader and read by a jest transform. `api/Dockerfile` copies `docs/guides`.
  - `HELIOS_AWS_ACCOUNT_ID` is required (12 digits). Locally it is `111111111111`, and the local customer bus lives in LocalStack's `000000000000`, so the own-account check stays meaningful. `EVENTBRIDGE_ENDPOINT` is optional, for LocalStack.
  - Local EventBridge e2e (`local/test/eventbridge.e2e.ts`): the shared LocalStack enables `events`, and the standalone profile now has `SERVICES: s3,sqs,events`.
- **2026-10-18 (step 5 review fixes):**
  - D1: AI usage is metered on every attempt. The client records into a per-attempt `UsageMeter` before validation, and processItem attaches the meter's usage on success, failure and interrupt.
  - D2: per-suite e2e scripts `test:local:<name>` (fanOut, worker, lifecycle, api, eventbridge, lambdas, transcribe). `test:local` stays the full run.
  - D3: no cross-attempt reuse of the native track.
  - Abort propagation: the signal flows through `transcribeAudio`, `chatJson` and `openaiRequest`. Waits are abortable. The translate loop checks the signal between batches.
  - Stale transcripts are removed after a successful run, with distinct native and translated file keys. `revision` is bumped on each write, and URLs use `?v=<revision>`.
  - Item callbacks for `transcribe` carry the transcript URLs.
  - Language hints are validated at intake. Chunks after the first reuse chunk 0's detected language.
  - Merge clamps each segment's end to the next start (see "Transcription worker step").
  - Strict json_schema rejects optional fields before sending. VTT cue text escapes `&`, `<` and `>`.
  - Retries cover network failures. Retry-After accepts HTTP-date and is capped. Timeouts are split by endpoint.
  - Sanitized item errors: `OpenAI request failed (openai_<status>_<code>)`.
  - Config is validated at startup. The chunk window must fit the upload limit.
  - Whisper `javanese` maps to `jv`.
  - PLAN drift fixes: the AI DLQ outcome is SKIPPED, and `UsageSummary` carries no LLM fields.
- **2026-10-18:** transcription uses `whisper-1` (verbose_json segments) for the native track. The English track is produced by LLM translation of the timed segments (json_schema), not the Whisper translations endpoint. There is no model fallback chain, unlike bella. Local e2e uses an OpenAI mock server, plus an opt-in real-API test.
- **2026-10-19:** transcription supports N extra translation languages. English is automatic for non-English sources (`english: false` opts out). Later requests are additive and reuse the native track; `retranscribe` regenerates everything.
