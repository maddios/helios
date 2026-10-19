import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const schema = z.object({
	stage: z.literal("local"),
	awsEndpoint: z.url(),
	awsRegion: z.string().min(1),
	awsAccessKeyId: z.string().min(1),
	awsSecretAccessKey: z.string().min(1),
	heliosAwsAccountId: z.string().regex(/^\d{12}$/),
	localBusAccountId: z.string().regex(/^\d{12}$/),
	mongoUri: z.string().min(1),
	queuePrefix: z.string().min(1),
	e2eQueuePrefix: z.string().min(1),
	mediaBucket: z.string().min(1),
	cdnBaseUrl: z.url(),
	cdnMode: z.literal("recording"),
	uploadUrlExpirySec: z.number().int().positive(),
	maxUploadBytes: z.number().int().positive(),
	sourceBucket: z.string().min(1),
	api: z.object({
		port: z.number().int().positive(),
		retryAfterSec: z.number().int().positive(),
		shutdownDrainSec: z.number().int().positive(),
		redeliverCooldownSec: z.number().int().positive(),
		destinationTestCooldownSec: z.number().int().positive()
	}),
	lambdaMaxDurationSec: z.number().positive(),
	lambdaMaxSourceBytes: z.number().int().positive(),
	sqsFairQueues: z.boolean(),
	scalerNotify: z.literal("none"),
	scalerNotifyMinIntervalMs: z.number().int().nonnegative(),
	fanoutResumeAfterSec: z.number().int().positive(),
	logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]),
	e2eLogLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]),
	worker: z.object({
		ffmpegPath: z.string().min(1),
		workDir: z.string().min(1),
		workerTier: z.enum(["lambda", "fargate"]),
		heartbeatSec: z.number().positive(),
		leaseSec: z.number().int().positive(),
		visibilityExtensionSec: z.number().int().positive(),
		workerIdleTimeoutSec: z.number().int().positive(),
		idleExit: z.boolean(),
		workerMemoryMb: z.number().int().positive(),
		workerVcpu: z.number().positive(),
		workerSpot: z.boolean(),
		transcribe: z.object({
			maxUploadBytes: z.number().int().positive(),
			chunkSec: z.number().int().positive(),
			overlapSec: z.number().int().nonnegative(),
			translateEffort: z.enum(["low", "medium", "high"]),
			translateBatchSegments: z.number().int().positive(),
			translateTargetConcurrency: z.number().int().positive()
		}),
		scenes: z.object({
			effort: z.enum(["low", "medium", "high"]),
			temperature: z.number().min(0).max(0.2),
			maxStills: z.number().int().positive(),
			windowSec: z.number().int().positive(),
			snapToleranceSec: z.number().nonnegative(),
			imageTransport: z.enum(["url", "base64"]),
			imageConcurrency: z.number().int().positive()
		})
	}),
	openai: z.object({
		apiKeySource: z.enum(["mock", "env"]),
		baseUrl: z.url(),
		mockPort: z.number().int().positive(),
		e2eMockPort: z.number().int().positive(),
		mockLanguage: z.string().min(1),
		realApiFixturePath: z.string().min(1),
		timeoutSec: z.number().int().positive(),
		transcribeTimeoutSec: z.number().int().positive(),
		maxAttempts: z.number().int().positive(),
		maxRetryAfterSec: z.number().int().positive(),
		organization: z.string().min(1).nullable()
	}),
	analyze: z.object({
		ffprobePath: z.string().min(1),
		analyzeTimeoutSec: z.number().int().positive(),
		sourceUrlTtlSec: z.number().int().positive(),
		maxIngestBytes: z.number().int().positive(),
		ingestTimeoutSec: z.number().int().positive()
	}),
	img: z.object({
		port: z.number().int().positive(),
		maxSourceBytes: z.number().int().positive(),
		maxInputPixels: z.number().int().positive()
	}),
	ssrfAllowedHosts: z.string(),
	callbackTimeoutSec: z.number().int().positive(),
	lambdas: z.object({
		memoryMb: z.number().int().positive(),
		pollWaitSec: z.number().int().nonnegative(),
		resumeIntervalSec: z.number().int().positive(),
		timeoutsSec: z.object({
			analyze: z.number().int().positive(),
			"lambda-p1": z.number().int().positive(),
			"lambda-ai": z.number().int().positive(),
			"callbacks.fifo": z.number().int().positive(),
			dlq: z.number().int().positive()
		}),
		e2eVisibilityTimeoutSec: z.number().int().positive()
	})
});

export type LocalConfig = z.infer<typeof schema>;

const ROOT = path.resolve(__dirname, "..");

export function loadLocalConfig(): LocalConfig {
	return schema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, "local", "config.json"), "utf8")));
}

function openAiEnv(openai: LocalConfig["openai"], e2e: boolean): Record<string, string> {
	const organization: Record<string, string> = openai.organization === null ? {} : { OPENAI_ORG: openai.organization };
	if (openai.apiKeySource === "env") {
		return { OPENAI_BASE_URL: openai.baseUrl, ...organization };
	}
	const port = e2e ? openai.e2eMockPort : openai.mockPort;
	return { OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`, OPENAI_API_KEY: "mock-key", ...organization };
}

export function applyLocalEnv(config: LocalConfig, { e2e }: { e2e: boolean }): void {
	const envFile = path.join(ROOT, ".env");
	if (fs.existsSync(envFile)) {
		process.loadEnvFile(envFile);
	}
	Object.assign(process.env, {
		STAGE: config.stage,
		QUEUE_PREFIX: e2e ? config.e2eQueuePrefix : config.queuePrefix,
		AWS_REGION: config.awsRegion,
		AWS_ACCESS_KEY_ID: config.awsAccessKeyId,
		AWS_SECRET_ACCESS_KEY: config.awsSecretAccessKey,
		SQS_ENDPOINT: config.awsEndpoint,
		S3_ENDPOINT: config.awsEndpoint,
		EVENTBRIDGE_ENDPOINT: config.awsEndpoint,
		HELIOS_AWS_ACCOUNT_ID: config.heliosAwsAccountId,
		IMAGE_BASE_URL: `http://localhost:${config.img.port}`,
		IMAGE_MAX_SOURCE_BYTES: String(config.img.maxSourceBytes),
		IMAGE_MAX_INPUT_PIXELS: String(config.img.maxInputPixels),
		MEDIA_BUCKET: config.mediaBucket,
		CDN_BASE_URL: config.cdnBaseUrl,
		CDN_MODE: config.cdnMode,
		UPLOAD_URL_EXPIRY_SEC: String(config.uploadUrlExpirySec),
		MAX_UPLOAD_BYTES: String(config.maxUploadBytes),
		MONGO_URI: config.mongoUri,
		LAMBDA_MAX_DURATION_SEC: String(config.lambdaMaxDurationSec),
		LAMBDA_MAX_SOURCE_BYTES: String(config.lambdaMaxSourceBytes),
		SQS_FAIR_QUEUES: String(config.sqsFairQueues),
		SCALER_NOTIFY: config.scalerNotify,
		SCALER_NOTIFY_MIN_INTERVAL_MS: String(config.scalerNotifyMinIntervalMs),
		FANOUT_RESUME_AFTER_SEC: String(config.fanoutResumeAfterSec),
		LOG_LEVEL: e2e ? config.e2eLogLevel : config.logLevel,
		FFMPEG_PATH: config.worker.ffmpegPath,
		FFPROBE_PATH: config.analyze.ffprobePath,
		ANALYZE_TIMEOUT_SEC: String(config.analyze.analyzeTimeoutSec),
		MAX_INGEST_BYTES: String(config.analyze.maxIngestBytes),
		INGEST_TIMEOUT_SEC: String(config.analyze.ingestTimeoutSec),
		CALLBACK_TIMEOUT_SEC: String(config.callbackTimeoutSec),
		SSRF_ALLOWED_HOSTS: config.ssrfAllowedHosts,
		WORK_DIR: path.resolve(ROOT, config.worker.workDir),
		WORKER_TIER: config.worker.workerTier,
		HEARTBEAT_SEC: String(config.worker.heartbeatSec),
		LEASE_SEC: String(config.worker.leaseSec),
		VISIBILITY_EXTENSION_SEC: String(config.worker.visibilityExtensionSec),
		SOURCE_URL_TTL_SEC: String(config.analyze.sourceUrlTtlSec),
		WORKER_IDLE_TIMEOUT_SEC: String(config.worker.workerIdleTimeoutSec),
		IDLE_EXIT: String(config.worker.idleExit),
		WORKER_MEMORY_MB: String(config.worker.workerMemoryMb),
		WORKER_VCPU: String(config.worker.workerVcpu),
		WORKER_SPOT: String(config.worker.workerSpot),
		TRANSCRIBE_MAX_UPLOAD_BYTES: String(config.worker.transcribe.maxUploadBytes),
		TRANSCRIBE_CHUNK_SEC: String(config.worker.transcribe.chunkSec),
		TRANSCRIBE_OVERLAP_SEC: String(config.worker.transcribe.overlapSec),
		TRANSLATE_EFFORT: config.worker.transcribe.translateEffort,
		TRANSLATE_BATCH_SEGMENTS: String(config.worker.transcribe.translateBatchSegments),
		TRANSLATE_TARGET_CONCURRENCY: String(config.worker.transcribe.translateTargetConcurrency),
		SCENES_EFFORT: config.worker.scenes.effort,
		SCENES_TEMPERATURE: String(config.worker.scenes.temperature),
		SCENES_MAX_STILLS: String(config.worker.scenes.maxStills),
		SCENES_WINDOW_SEC: String(config.worker.scenes.windowSec),
		SCENES_SNAP_TOLERANCE_SEC: String(config.worker.scenes.snapToleranceSec),
		SCENES_IMAGE_TRANSPORT: config.worker.scenes.imageTransport,
		SCENES_IMAGE_CONCURRENCY: String(config.worker.scenes.imageConcurrency),
		...openAiEnv(config.openai, e2e),
		API_PORT: String(config.api.port),
		RETRY_AFTER_SEC: String(config.api.retryAfterSec),
		SHUTDOWN_DRAIN_SEC: String(config.api.shutdownDrainSec),
		REDELIVER_COOLDOWN_SEC: String(config.api.redeliverCooldownSec),
		DESTINATION_TEST_COOLDOWN_SEC: String(config.api.destinationTestCooldownSec),
		OPENAI_TIMEOUT_SEC: String(config.openai.timeoutSec),
		OPENAI_TRANSCRIBE_TIMEOUT_SEC: String(config.openai.transcribeTimeoutSec),
		OPENAI_MAX_ATTEMPTS: String(config.openai.maxAttempts),
		OPENAI_MAX_RETRY_AFTER_SEC: String(config.openai.maxRetryAfterSec)
	});
}
