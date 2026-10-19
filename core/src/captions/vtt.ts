const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const UNESCAPES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">" };

export function escapeVtt(text: string): string {
	return text.replace(/[&<>]/g, (char) => ESCAPES[char]);
}

export function unescapeVtt(text: string): string {
	return text.replace(/&(?:amp|lt|gt);/g, (entity) => UNESCAPES[entity]);
}
