export interface ChunkOptions {
	maxUploadBytes: number;
	chunkSec: number;
	overlapSec: number;
}

export interface ChunkPlan {
	index: number;
	start: number;
	end: number;
	keepFrom: number;
	keepUntil: number;
}

export class NoAudioDurationError extends Error {
	constructor(durationSec: number) {
		super(`Cannot plan transcription chunks for ${durationSec} seconds of audio`);
		this.name = "NoAudioDurationError";
	}
}

export function planChunks(durationSec: number, fileBytes: number, options: ChunkOptions): ChunkPlan[] {
	if (!(durationSec > 0)) {
		throw new NoAudioDurationError(durationSec);
	}
	if (fileBytes <= options.maxUploadBytes) {
		return [{ index: 0, start: 0, end: durationSec, keepFrom: 0, keepUntil: Infinity }];
	}
	const count = Math.ceil(durationSec / options.chunkSec);
	return Array.from({ length: count }, (_, index) => {
		const keepFrom = index * options.chunkSec;
		return {
			index,
			start: Math.max(0, keepFrom - options.overlapSec),
			end: Math.min(durationSec, keepFrom + options.chunkSec + options.overlapSec),
			keepFrom,
			keepUntil: index === count - 1 ? Infinity : keepFrom + options.chunkSec
		};
	});
}
