import os from "node:os";
import path from "node:path";

process.env.FFMPEG_PATH = "ffmpeg";
process.env.FFPROBE_PATH = "ffprobe";
process.env.WORK_DIR = path.join(os.tmpdir(), "helios-worker-test");
process.env.WORKER_TIER = "fargate";
process.env.HEARTBEAT_SEC = "30";
process.env.LEASE_SEC = "90";
process.env.VISIBILITY_EXTENSION_SEC = "120";
process.env.SOURCE_URL_TTL_SEC = "3600";
process.env.WORKER_IDLE_TIMEOUT_SEC = "60";
process.env.IDLE_EXIT = "false";
process.env.WORKER_MEMORY_MB = "2048";
process.env.WORKER_VCPU = "1";
process.env.WORKER_SPOT = "false";
