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
  - **Queues: SQS priority queues.** Visibility timeout = lease, `ChangeMessageVisibility` = heartbeat, `maxReceiveCount` + DLQ = retries.
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

| prio | name | output | params |
|---|---|---|---|
| 10 | `mp4_360` (default) | `{id}.mp4` | h360, 800k VBR, AAC 96k 44.1kHz |
| 10→child | `stills` | `tmb/%04d.jpg` | mjpeg `fps=1/3`, source resolution |
| 40 | `audio` | `{id}.mp3` | libmp3lame 92k 44.1kHz |
| 100 | `mp4_720` | `{id}_720_1800.mp4` | h720, 1800k VBR, AAC 256k |
| 110 | `mp4_1080` | `{id}_1080_2700.mp4` | h1080, 2700k VBR, AAC 256k |

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

| Item | Short/small source (≤ `LAMBDA_MAX_DURATION_SEC` and ≤ `LAMBDA_MAX_SOURCE_BYTES`) | Long/large source |
|---|---|---|
| Default profile + its children (e.g. `mp4_360` + `stills`) | `lambda-p1` | `fargate-p1` |
| `transcribe`, `scenes` | `lambda-ai` | `fargate-p3` |
| Other renditions/profiles (`mp4_720`, `mp4_1080`, `audio` MP3, novel extras) | `fargate-p2` (always) | `fargate-p2` |
| Re-encode / bulk | `fargate-p4` | `fargate-p4` |

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
  - The **scaler Lambda** (invoked async after each Fargate enqueue + every minute) starts `min(backlog, MAX_WORKERS) - running` **burst** tasks. Burst tasks self-exit after `WORKER_IDLE_TIMEOUT_SEC`.
- **Deploy-time options** (serverless `custom` per stage → env):

| Option | Purpose | Example dev / prod |
|---|---|---|
| `WARM_WORKERS` | Number of always-on Fargate workers (0 = none). The scaler keeps this many **warm** tasks (tag `role=warm`, `IDLE_EXIT=false`) running; burst tasks (`role=burst`) idle-exit. | 0 / 1 |
| `MAX_WORKERS` | Cap on Fargate tasks | 3 / 20 |
| `WORKER_IDLE_TIMEOUT_SEC` | Burst task idle exit | 600 / 1800 |
| `WORKER_CPU` / `WORKER_MEMORY` / `WORKER_SPOT` | Fargate task size and Spot use | 4096 / 8192 / true for p4 |
| `LAMBDA_MAX_DURATION_SEC` / `LAMBDA_MAX_SOURCE_BYTES` | Routing thresholds | 180 / 500 MB |
| `LAMBDA_MAX_CONCURRENCY` | Cap on concurrent Lambda encodes | 5 / 50 |
| `ENCODE_LAMBDA_MEMORY_MB` | Encoder Lambda size | 4096 / 10240 |

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
- **Worker claim:** a worker claims an item with `findOneAndUpdate({_id, $or:[{status:QUEUED}, {status:IN_PROGRESS, messageId}]})`, setting `status: IN_PROGRESS` and `messageId`. A duplicate delivery matches neither branch, so it is acked without doing any work. The claim also requires the request not CANCELLED, so items inserted by a fan-out resume racing a cancel never run.
- **Completion handler (idempotent; the SQS message is deleted last):**
  1. `$set` the item to COMPLETE plus its output. If it is already COMPLETE, skip the work and rerun only the handoff.
  2. For each dependent: `$pull` the completed id from its `pendingDeps`, then `findOneAndUpdate({_id, status:BLOCKED, pendingDeps:{$size:0}} → QUEUED)`. Only the winner sends it to SQS. Each worker also applies the never-upscale rule `min(height, sourceH)` before encoding.
  3. Enqueue the per-item callback.
  4. `findOneAndUpdate({_id: requestId, pendingItems: itemId}, {$pull: {pendingItems: itemId}}, {returnDocument: after})`. The caller that leaves `pendingItems` empty finalizes: request status, job report, final callback.
  5. Delete the SQS message.
- **Terminal statuses:** COMPLETE, SKIPPED, ERROR and CANCELLED all set `completedAt`, which starts the TTL.
- **Crash at any point:** the message reappears after the visibility timeout, and the handler reruns safely.
- **Fan-out recovery (the scaler owns it):** once the `requests` doc is persisted, finishing the request is Helios's job, never the client's.
  - The scaler's 1-minute schedule also runs the fan-out resume for every request with `status: IN_PROGRESS`, no `enqueuedAt`, and `createdAt` older than `FANOUT_RESUME_AFTER_SEC`. Fan-out is idempotent, so this is safe.
  - This needs a partial index on `{createdAt: 1}` where `enqueuedAt` doesn't exist.
- **Client-facing errors:**
  - `POST /encode` returns 202 with the request id as soon as the request doc is written, even if a later fan-out write (items, SQS) fails; the resumer completes it.
  - The API returns `503 Service Unavailable` ("can't process right now, try again later") only when the request can't be persisted at all, i.e. a system outage.
  - The SDK still generates a `requestId` internally and reuses it on network retries for idempotency, invisibly to the user.
- **DLQ consumer Lambda:** marks the item ERROR (or SKIPPED for optional AI steps), releases dependents according to policy, `$pull`s the item from `pendingItems`, and fires the error callback.
- **SIGTERM (Fargate):** set the message visibility to 0 so another worker picks it up immediately.
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
5. Errors are retried via SQS redelivery (`maxReceiveCount` 3). The DLQ consumer marks the step ERROR and lets `scenes` proceed stills-only. The error message is stored on the item.

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
  - *Build step:* model now; handled by the worker in step 2; route in step 3.
- **Preset snapshot (addition 2):**
  - Fan-out stores the resolved profiles + `postProcess` defaults on the asset (`presetSnapshot`, `presetVersion`) and on the request.
  - Re-encode uses the asset's snapshot by default. `refreshPreset: true` takes the current preset instead; there is no old/new merge, unlike encoding-laravel.
  - *Build step:* now.
- **Idempotency through a client-supplied request id (addition 3):**
  - The request id itself is the idempotency key. Callers may send their own `requestId` (a UUID), stored as `clientRequestId` and unique per account.
  - A repeat returns the existing request. A repeat with a different asset or mode is rejected. With no `requestId` given, the server generates one.
  - `requests.assetVersion` is the asset version the request leaves behind: `version + 1` for re-encode, otherwise the current version. The asset update applies it with `$max`, so a fan-out resumed after a crash bumps the version exactly once.
  - A server-generated id alone can't dedupe, because a client whose POST timed out never received it.
  - *Build step:* model/fan-out now; route in step 3.
- **Usage metering for dashboard stats (addition 5):**
  - Items record `usage: {computeTier, computeSec, outputBytes, audioSec, llmInputTokens, llmOutputTokens, model}`.
  - `job_reports` rolls these up per request.
  - `GET /usage?from&to&groupBy` serves the console.
  - *Build step:* schema now; filled in by the workers.

## API notes
- **OpenAPI (addition 7):** generated from the zod schemas (`@asteasolutions/zod-to-openapi`) and served at `/docs`. The SDK types come from the same schemas. *Build step:* 3 + 8.
- **Callback delivery log + redeliver (addition 8):**
  - A `callback_deliveries` collection, `GET /requests/:id/callbacks` and `POST /requests/:id/callbacks/redeliver`.
  - *Build step:* 3 + 4.
- **`dryRun` (addition 12):** `POST /encode?dryRun=true` returns the `planItems` output (items, queues, deps) and writes nothing. *Build step:* 3.
- **Other routes added by the additions:**
  - `DELETE /requests/:id` (cancel, addition 4), *build step:* 3.
  - `PATCH /assets/:id/active-still` (addition 1), *build step:* 3.
  - `GET /usage` (addition 5), *build step:* 3.
  - `DELETE /assets/:id` (purge, addition 11), *build step:* 3.
- **Preset routes:** see "Preset management API".

## Observability
- **Logs and tracing (addition 9):**
  - pino JSON logs with `accountId`/`requestId`/`itemId`/`assetId`, propagated as SQS message attributes through API → Lambda → worker.
  - Workers log ffmpeg progress into `pipeline_items.progress`, and the last 50 ffmpeg stderr lines into `error` on failure. This matches the per-thread visibility encoding-laravel had.
  - dd-trace is optional (bella uses Datadog).
  - *Build step:* the logger in core now; used throughout.
- **Alarms + Slack (addition 10):**
  - CloudWatch alarms on DLQ depth, `ApproximateAgeOfOldestMessage` per tier, the Lambda→Fargate redrive rate, and the error rate.
  - They go to an SNS topic, then Slack through AWS Chatbot (no code), with a channel configured per stage.
  - *Build step:* 9.

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
  - *Build step:* the toggle now; purge in steps 2–4.

## Corrections to the gist (applied)
1. **Priority:** set by queue tier (p1→p4) rather than a sort key. Every video's default rendition is processed before secondary profiles.
2. **Leases:** SQS visibility timeout + heartbeat. Redelivery handles worker crashes, so no sweep job is needed. On SIGTERM, set visibility to 0.
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
   - CDN: `?v=` with only `v` allow-listed.
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
await helios.requests.wait(request.id);                           // polling helper with backoff
const event = helios.webhooks.verify(rawBody, signatureHeader);   // typed discriminated union
```

**Advanced, through resource namespaces:**

| Namespace | Methods |
|---|---|
| `uploads` | Manual multipart: `create`/`signParts`/`complete`/`abort`. `uploadAndEncode` handles part sizing, concurrency, per-part retry, `AbortSignal` and progress. |
| `encodes` | `create` (`dryRun`, `requestId` idempotency, `postProcess`), `reencode` (`refreshPreset`) |
| `requests` | `get`, `cancel`, `wait`, `callbacks.list`/`redeliver` |
| `assets` | `get`, `delete` (purge), `setActiveStill`, `postProcess` |
| `transcripts` | `list` |
| `scenes` | `get` |
| `presets` | CRUD, `updateProfile`, `clone`, `dryRun` |
| `files` | |
| `images` | `url(key, { w, h, q, f, pad, bg })`: a pure URL builder |
| `usage` | `get` |

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
- **2026-10-17:** Mongo layer: raw `mongodb` v6 driver + zod.
- **2026-10-17:** Repo: npm workspaces monorepo (`contracts`, `core`, `api`, `functions`, `worker`, `sdk`).
- **2026-10-17:** TypeScript 6.0 (ts-jest doesn't support TS 7 yet).
- **2026-10-17:** Node 22.
- **2026-10-17:** CommonJS.
- **2026-10-17:** String UUID `_id` for all collections.
- **2026-10-17:** `pipeline_items` TTL: 30 days after `completedAt`.
- **2026-10-17:** Dependency tracking uses id sets, not counters. Items hold `pendingDeps: [ids]`, requests hold `pendingItems: [ids]`. Replays are idempotent, and a duplicate SQS send is acceptable.
- **2026-10-17:** Request `_id` is always a server UUID. The per-account unique key is `{accountId, clientRequestId}`, where `clientRequestId` is the API's `requestId`. A repeat with a different asset or mode throws `RequestIdConflictError`, and a repeat of a request that was already enqueued or CANCELLED returns it without writes. Otherwise fan-out resumes: it plans once from the stored snapshot, inserts missing items, and enqueues only the items whose DB status is QUEUED.
- **2026-10-17:** Zero-work requests (no non-SKIPPED item) fail with `NothingToDoError`, which the API maps to 422, before any write.
- **2026-10-17:** Silent video gets no MP3 item, and its transcribe item is SKIPPED. Images get no transcribe item. A dedicated `image_still` profile (stills, `maxCount: 1`) is a child of `image`.
- **2026-10-17:** Client idempotency field renamed `requestId` → `clientRequestId` on the request doc. `requestId` on items, message attributes and logs always means `requests._id`. `FanOutInput` keeps the public name `requestId`.
- **2026-10-17:** `requests.assetVersion` is stored at fan-out and applied to the asset with `$max`, so a resumed re-encode bumps the version once.
- **2026-10-17:** Preset refinements: a child profile must be `stills` and not default; every default profile must be `video` or `image`.
- **2026-10-17:** LocalStack pinned to `localstack/localstack:4.14` (compose standalone profile and the shared instance).
- **2026-10-17:** `SQS_FAIR_QUEUES` config flag. The shared LocalStack was upgraded 4.5 → 4.14 (`localstack:4`; `latest` now requires a paid auth token), so it is `true` locally and on AWS.
- **2026-10-17:** stuck fan-outs are resumed by the scaler (1-minute schedule, `FANOUT_RESUME_AFTER_SEC`); the API returns 202 once the request is persisted and 503 only when it cannot be persisted. Build in step 4 (scaler); the index lands with the step 2 model work.
