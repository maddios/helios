import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseSrt } from "@helios/core";
import { normalizePartnrup } from "./partnrup";
import type { EvalSample } from "./types";

const ENGLISH_LANGUAGE_ID = 1;

const MetaSchema = z.object({
	mediaId: z.int(),
	languageId: z.int(),
	durationSec: z.number().positive(),
	stills: z.array(z.object({ index: z.int(), timestampSec: z.number(), file: z.string().min(1) }))
});

export async function loadSamples(samplesDir: string, limit: number | undefined): Promise<EvalSample[]> {
	const samples: EvalSample[] = [];
	for (const name of sampleDirNames(samplesDir).slice(0, limit)) {
		samples.push(await loadSample(path.join(samplesDir, name)));
	}
	return samples;
}

function sampleDirNames(samplesDir: string): string[] {
	if (!fs.existsSync(samplesDir)) {
		throw new Error(`Samples directory not found: ${samplesDir}`);
	}
	const names = fs
		.readdirSync(samplesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
		.map((entry) => entry.name)
		.sort((a, b) => Number(a) - Number(b));
	if (names.length === 0) {
		throw new Error(`No sample directories in ${samplesDir}`);
	}
	return names;
}

async function loadSample(dir: string): Promise<EvalSample> {
	const meta = MetaSchema.parse(JSON.parse(await fs.promises.readFile(path.join(dir, "meta.json"), "utf8")));
	if (meta.languageId !== ENGLISH_LANGUAGE_ID) {
		throw new Error(`Sample ${meta.mediaId} has languageId ${meta.languageId}; only English (1) is supported`);
	}
	const srt = await fs.promises.readFile(path.join(dir, "transcript.srt"), "utf8");
	const partnrupRaw: unknown = JSON.parse(
		await fs.promises.readFile(path.join(dir, "timestamp_analysis.json"), "utf8")
	);
	return {
		mediaId: meta.mediaId,
		durationSec: meta.durationSec,
		stills: meta.stills.map((still) => ({
			index: still.index,
			timestampSec: still.timestampSec,
			absPath: path.join(dir, still.file)
		})),
		transcript: parseSrt(srt),
		baseline: normalizePartnrup(partnrupRaw, meta.durationSec)
	};
}
