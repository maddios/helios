import { filetypeinfo } from "magic-bytes.js";
import { imageSize } from "image-size";

export const SNIFF_BYTES = 256 * 1024;
const TEXT_SAMPLE_BYTES = 512;
const HTML_START = /^﻿?\s*<(!doctype\s+html|html)[\s>]/i;
const SVG_START = /^﻿?\s*(<\?xml[^>]*>\s*)?(<!doctype[^>]*>\s*)?<svg[\s>]/i;
const ROTATED_ORIENTATIONS = new Set([5, 6, 7, 8]);

export interface SniffedImage {
	width: number;
	height: number;
	format: string;
}

export interface SniffedFile {
	/** The primary type the bytes are, which is what the file record stores. */
	contentType: string;
	/** Every type the magic numbers match, primary first. Used to check declared and allowed types. */
	candidates: string[];
	image?: SniffedImage;
}

export function sniffHead(head: Buffer): SniffedFile {
	const markup = sniffMarkup(head);
	if (markup !== undefined) {
		return { contentType: markup, candidates: [markup] };
	}
	const detected = filetypeinfo(head).filter((info) => typeof info.mime === "string");
	const [primary] = detected;
	if (primary === undefined) {
		const contentType = isUtf8Text(head.subarray(0, TEXT_SAMPLE_BYTES)) ? "text/plain" : "application/octet-stream";
		return { contentType, candidates: [contentType] };
	}
	const contentType = primary.mime as string;
	const image = contentType.startsWith("image/") ? imageInfo(head, primary.extension ?? "") : undefined;
	return {
		contentType,
		candidates: detected.map((info) => info.mime as string),
		...(image !== undefined && { image })
	};
}

/** SVG and HTML are text. The magic numbers name an SVG only when it starts with `<svg`, and never name HTML, so both are read from the markup. */
function sniffMarkup(head: Buffer): string | undefined {
	const sample = head.subarray(0, TEXT_SAMPLE_BYTES);
	if (!isUtf8Text(sample)) {
		return undefined;
	}
	const text = sample.toString("utf8");
	if (SVG_START.test(text)) {
		return "image/svg+xml";
	}
	return HTML_START.test(text) ? "text/html" : undefined;
}

function isUtf8Text(sample: Buffer): boolean {
	if (sample.includes(0)) {
		return false;
	}
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true });
		return true;
	} catch {
		return false;
	}
}

function imageInfo(head: Buffer, format: string): SniffedImage | undefined {
	const dimensions = readDimensions(head);
	if (dimensions === undefined) {
		return undefined;
	}
	const { width, height, orientation } = dimensions;
	const rotated = orientation !== undefined && ROTATED_ORIENTATIONS.has(orientation);
	return rotated ? { width: height, height: width, format } : { width, height, format };
}

function readDimensions(head: Buffer) {
	try {
		return imageSize(head);
	} catch {
		return undefined;
	}
}
