const CUE_TIMING = /^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})/;

export function formatTimestamp(sec: number, separator: "," | "."): string {
	// Rounding to microseconds first keeps e.g. 1.234 * 1000 (1233.999...) from flooring to 1233.
	const totalMs = Math.floor(Math.round(sec * 1e6) / 1000);
	const ms = totalMs % 1000;
	const totalSec = Math.floor(totalMs / 1000);
	const hours = Math.floor(totalSec / 3600);
	const minutes = Math.floor(totalSec / 60) % 60;
	const seconds = totalSec % 60;
	return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${separator}${pad(ms, 3)}`;
}

export function parseCueTiming(line: string): { start: number; end: number } | undefined {
	const match = CUE_TIMING.exec(line);
	if (match === null) {
		return undefined;
	}
	const [, sh, sm, ss, sms, eh, em, es, ems] = match;
	return { start: millis(sh, sm, ss, sms) / 1000, end: millis(eh, em, es, ems) / 1000 };
}

function millis(hours: string | undefined, minutes: string, seconds: string, ms: string): number {
	return ((Number(hours ?? 0) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(ms);
}

function pad(value: number, width: number): string {
	return String(value).padStart(width, "0");
}
