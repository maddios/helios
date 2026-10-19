import sharp from "sharp";
import type { ImageFormat, ImageTransform } from "@helios/core";
import { ImageHttpError } from "./errors";

export interface RenderedImage {
	body: Buffer;
	contentType: string;
	format: ImageFormat;
}

interface SourceInfo {
	width: number;
	height: number;
	format: string | undefined;
}

const SHARP_FORMATS: Record<ImageFormat, "jpeg" | "png" | "webp" | "avif"> = {
	jpg: "jpeg",
	png: "png",
	webp: "webp",
	avif: "avif"
};

const CONTENT_TYPES: Record<ImageFormat, string> = {
	jpg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	avif: "image/avif"
};

const ENCODABLE_SOURCE_FORMATS: Partial<Record<string, ImageFormat>> = {
	jpeg: "jpg",
	png: "png",
	webp: "webp",
	avif: "avif"
};

const ALLOWED_SOURCE_FORMATS = ["jpeg", "png", "webp", "avif", "gif", "tiff"];
const WHITE = "#ffffff";
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

export async function renderVariant(
	source: Buffer,
	transform: ImageTransform,
	maxInputPixels: number
): Promise<RenderedImage> {
	const info = await readSourceInfo(source);
	if (info.width * info.height > maxInputPixels) {
		throw new ImageHttpError(422, "too_many_pixels");
	}
	const format = outputFormat(info.format, transform);
	const resized = sharp(source, { limitInputPixels: maxInputPixels }).rotate().resize(resizeOptions(transform, format));
	const pipeline = format === "jpg" ? resized.flatten({ background: WHITE }) : resized;
	return { body: await encode(pipeline, format, transform.q), contentType: CONTENT_TYPES[format], format };
}

async function readSourceInfo(source: Buffer): Promise<SourceInfo> {
	let metadata: sharp.Metadata;
	try {
		metadata = await sharp(source).metadata();
	} catch {
		throw new ImageHttpError(415, "not_an_image");
	}
	if (metadata.width === undefined || metadata.height === undefined) {
		throw new ImageHttpError(415, "not_an_image");
	}
	const format = metadata.format === "heif" && metadata.compression === "av1" ? "avif" : metadata.format;
	if (format === undefined || !ALLOWED_SOURCE_FORMATS.includes(format)) {
		throw new ImageHttpError(415, "unsupported_source_format");
	}
	return { width: metadata.width, height: metadata.height, format };
}

function outputFormat(sourceFormat: string | undefined, transform: ImageTransform): ImageFormat {
	const format = transform.f ?? ENCODABLE_SOURCE_FORMATS[sourceFormat ?? ""];
	if (format === undefined) {
		throw new ImageHttpError(415, "format_required");
	}
	return format;
}

function resizeOptions(transform: ImageTransform, format: ImageFormat): sharp.ResizeOptions {
	const { w: width, h: height, g: gravity } = transform;
	switch (transform.c ?? "fit") {
		case "fill":
			return { width, height, fit: "cover", position: gravity ?? "center" };
		case "pad":
			return { width, height, fit: "contain", background: paddingBackground(transform, format) };
		case "limit":
			return { width, height, fit: "inside", withoutEnlargement: true };
		case "fit":
			return { width, height, fit: "inside" };
	}
}

function paddingBackground(transform: ImageTransform, format: ImageFormat): string | typeof TRANSPARENT {
	if (transform.b !== undefined) {
		return `#${transform.b}`;
	}
	return format === "jpg" ? WHITE : TRANSPARENT;
}

async function encode(pipeline: sharp.Sharp, format: ImageFormat, quality: number | undefined): Promise<Buffer> {
	try {
		return await pipeline.toFormat(SHARP_FORMATS[format], quality === undefined ? {} : { quality }).toBuffer();
	} catch {
		throw new ImageHttpError(422, "transform_failed");
	}
}
