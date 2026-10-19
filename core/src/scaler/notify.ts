import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { config } from "../config";
import { contextLogger } from "../logger";

let client: LambdaClient | undefined;
let lastNotifiedAt: number | undefined;

function lambda(): LambdaClient {
	client ??= new LambdaClient({ region: config().AWS_REGION });
	return client;
}

export async function notifyScaler(): Promise<void> {
	const cfg = config();
	if (cfg.SCALER_NOTIFY === "none") {
		return;
	}
	const now = Date.now();
	if (lastNotifiedAt !== undefined && now - lastNotifiedAt < cfg.SCALER_NOTIFY_MIN_INTERVAL_MS) {
		return;
	}
	lastNotifiedAt = now;
	try {
		await lambda().send(new InvokeCommand({ FunctionName: cfg.SCALER_FUNCTION_NAME, InvocationType: "Event" }));
	} catch (err) {
		contextLogger({}).error({ err }, "Scaler notify failed; the scheduled scaler run will cover it");
	}
}

export function resetNotifyForTests(): void {
	client = undefined;
	lastNotifiedAt = undefined;
}
