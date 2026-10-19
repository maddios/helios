import path from "node:path";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

export function pct(value: number | null): string {
	return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

export function num(value: number | null, digits = 1): string {
	return value === null ? "n/a" : value.toFixed(digits);
}

export function formatSec(sec: number): string {
	return `${sec.toFixed(1)}s`;
}

export function formatMs(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

export function relativeHref(fromDir: string, absPath: string): string {
	return path.relative(fromDir, absPath).split(path.sep).join("/");
}
