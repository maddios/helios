import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { applyLocalEnv, loadLocalConfig } from "../../local/loadConfig";
import { startOpenAiMock } from "../../local/openaiMock";

const ROOT = path.resolve(__dirname, "..", "..");
const REAL_OPENAI_BASE_URL = "https://api.openai.com/v1";
const MOCK_API_KEY = "mock-key";

export type CloseEnv = () => Promise<void>;

export async function prepareEvalEnv(mock: boolean): Promise<CloseEnv> {
	const local = loadLocalConfig();
	applyLocalEnv(local, { e2e: false });
	if (mock) {
		const server = await startOpenAiMock({ port: local.openai.mockPort, language: local.openai.mockLanguage });
		Object.assign(process.env, {
			OPENAI_BASE_URL: `http://127.0.0.1:${local.openai.mockPort}/v1`,
			OPENAI_API_KEY: MOCK_API_KEY
		});
		return () => server.close();
	}
	Object.assign(process.env, { OPENAI_BASE_URL: REAL_OPENAI_BASE_URL, OPENAI_API_KEY: readOpenAiKey() });
	return async () => undefined;
}

function readOpenAiKey(): string {
	const envFile = path.join(ROOT, ".env");
	const env: Record<string, string | undefined> = fs.existsSync(envFile)
		? parseEnv(fs.readFileSync(envFile, "utf8"))
		: {};
	const key = env.OPENAI_API_KEY;
	if (key === undefined || key.trim() === "") {
		throw new Error(
			`OPENAI_API_KEY is missing from ${envFile}; the scene eval needs real OpenAI credentials (or use --mock)`
		);
	}
	return key;
}
