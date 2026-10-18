import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const schema = z.object({
	stage: z.literal("local"),
	awsEndpoint: z.url(),
	awsRegion: z.string().min(1),
	awsAccessKeyId: z.string().min(1),
	awsSecretAccessKey: z.string().min(1),
	mongoUri: z.string().min(1),
	queuePrefix: z.string().min(1),
	e2eQueuePrefix: z.string().min(1),
	mediaBucket: z.string().min(1),
	cdnBaseUrl: z.url(),
	uploadUrlExpirySec: z.number().int().positive(),
	maxUploadBytes: z.number().int().positive(),
	sourceBucket: z.string().min(1),
	lambdaMaxDurationSec: z.number().positive(),
	lambdaMaxSourceBytes: z.number().int().positive(),
	sqsFairQueues: z.boolean(),
	logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]),
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
		workerSpot: z.boolean()
	}),
	analyze: z.object({
		ffprobePath: z.string().min(1),
		analyzeTimeoutSec: z.number().int().positive(),
		sourceUrlTtlSec: z.number().int().positive(),
		maxIngestBytes: z.number().int().positive(),
		ingestTimeoutSec: z.number().int().positive()
	}),
	ssrfAllowedHosts: z.string()
});

export type LocalConfig = z.infer<typeof schema>;

const ROOT = path.resolve(__dirname, "..");

export function loadLocalConfig(): LocalConfig {
	return schema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, "local", "config.json"), "utf8")));
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
		MEDIA_BUCKET: config.mediaBucket,
		CDN_BASE_URL: config.cdnBaseUrl,
		UPLOAD_URL_EXPIRY_SEC: String(config.uploadUrlExpirySec),
		MAX_UPLOAD_BYTES: String(config.maxUploadBytes),
		MONGO_URI: config.mongoUri,
		LAMBDA_MAX_DURATION_SEC: String(config.lambdaMaxDurationSec),
		LAMBDA_MAX_SOURCE_BYTES: String(config.lambdaMaxSourceBytes),
		SQS_FAIR_QUEUES: String(config.sqsFairQueues),
		LOG_LEVEL: config.logLevel,
		FFMPEG_PATH: config.worker.ffmpegPath,
		FFPROBE_PATH: config.analyze.ffprobePath,
		ANALYZE_TIMEOUT_SEC: String(config.analyze.analyzeTimeoutSec),
		MAX_INGEST_BYTES: String(config.analyze.maxIngestBytes),
		INGEST_TIMEOUT_SEC: String(config.analyze.ingestTimeoutSec),
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
		WORKER_SPOT: String(config.worker.workerSpot)
	});
}
