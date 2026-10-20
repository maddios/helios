const ALIAS_GROUPS: readonly (readonly string[])[] = [
	["video/webm", "video/x-matroska"],
	["image/heic", "image/heif"],
	["audio/wav", "audio/x-wav", "audio/wave"]
];

const OOXML_EXTENSIONS: Readonly<Record<string, string>> = {
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx"
};

const M4A_AUDIO_TYPES = new Set(["audio/mp4", "audio/x-m4a"]);

const INLINE_TYPE = /^((image|video|audio)\/|application\/pdf$)/;

export function matchesPattern(pattern: string, contentType: string): boolean {
	if (pattern === "*/*" || pattern === contentType) {
		return true;
	}
	return pattern.endsWith("/*") && contentType.startsWith(pattern.slice(0, -1));
}

export function sameType(a: string, b: string): boolean {
	return a === b || ALIAS_GROUPS.some((group) => group.includes(a) && group.includes(b));
}

/**
 * Whether a declared content type is what the bytes are. The candidates are every type the magic numbers match,
 * so a container that several types share (WebM, HEIC, WAV) matches each of its names. OOXML files are zip archives,
 * and the magic numbers of any zip match every OOXML type, so those match on the zip signature and the extension.
 * An m4a file is an mp4 container, so it matches an audio type by its extension.
 */
export function typeMatches(declared: string, candidates: readonly string[], filename: string): boolean {
	const name = filename.toLowerCase();
	const ooxmlExtension = OOXML_EXTENSIONS[declared];
	if (ooxmlExtension !== undefined) {
		return candidates.includes("application/zip") && name.endsWith(`.${ooxmlExtension}`);
	}
	if (M4A_AUDIO_TYPES.has(declared)) {
		return candidates.includes("video/mp4") && name.endsWith(".m4a");
	}
	return candidates.some((candidate) => sameType(declared, candidate));
}

/** Types a browser renders on the CDN domain. SVG and HTML are not in this set: they are served as attachments. */
export function isInlineType(contentType: string): boolean {
	return INLINE_TYPE.test(contentType) && contentType !== "image/svg+xml";
}

export function contentDispositionFor(contentType: string): "inline" | "attachment" {
	return isInlineType(contentType) ? "inline" : "attachment";
}
