import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { transcribeAudio, UsageMeter } from "@helios/core";
import { resetConfigForTests } from "../../worker/src/config";
import { translateSegments } from "../../worker/src/transcribe/translateSegments";
import { applyLocalEnv, loadLocalConfig } from "../loadConfig";

const ROOT = path.resolve(__dirname, "..", "..");
const SPANISH_TEXT =
	"Hola, este es un mensaje de prueba. Estamos grabando una frase corta en español para comprobar la transcripción.";

const local = loadLocalConfig();
applyLocalEnv({ ...local, openai: { ...local.openai, apiKeySource: "env" } }, { e2e: true });
resetConfigForTests();

const fixturePath = path.join(ROOT, local.openai.realApiFixturePath);

function commandAvailable(command: string): boolean {
	return spawnSync(command, ["--version"]).status === 0;
}

function generateFixture(): void {
	const speech = commandAvailable("espeak-ng") ? "espeak-ng" : "espeak";
	const wav = `${fixturePath}.wav`;
	fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
	spawnSync(speech, ["-v", "es", "-w", wav, SPANISH_TEXT], { stdio: "inherit" });
	spawnSync(local.worker.ffmpegPath, ["-y", "-loglevel", "error", "-i", wav, "-c:a", "libmp3lame", fixturePath], {
		stdio: "inherit"
	});
	fs.rmSync(wav, { force: true });
}

const apiKey = process.env.OPENAI_API_KEY;
const hasSpeechTool = commandAvailable("espeak-ng") || commandAvailable("espeak");
if (apiKey === undefined) {
	console.warn("test:openai skipped: OPENAI_API_KEY is not set in the root .env");
} else if (!hasSpeechTool && !fs.existsSync(fixturePath)) {
	console.warn(`test:openai skipped: no espeak-ng/espeak and no fixture at ${fixturePath}`);
} else if (!fs.existsSync(fixturePath)) {
	generateFixture();
}

const suite = apiKey === undefined || !fs.existsSync(fixturePath) ? describe.skip : describe;

suite("OpenAI real API", () => {
	it("transcribes Spanish speech and translates it to English with aligned timings", async () => {
		const meter = new UsageMeter();
		const signal = new AbortController().signal;
		const native = await transcribeAudio({ filePath: fixturePath, meter, signal });
		const translated = await translateSegments({
			segments: native.segments,
			sourceLanguage: native.language,
			targetLanguage: "en",
			meter,
			signal
		});

		expect(native.language).toBe("es");
		expect(native.segments.length).toBeGreaterThan(0);
		expect(translated.segments.map(({ start, end }) => [start, end])).toEqual(
			native.segments.map(({ start, end }) => [start, end])
		);
		expect(translated.segments.some((segment) => segment.text.trim() !== "")).toBe(true);
		for (const segment of native.segments) {
			expect(segment.end).toBeGreaterThanOrEqual(segment.start);
		}
	}, 300000);
});
