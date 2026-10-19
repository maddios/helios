import {
	canonicalPath,
	config,
	objectStore,
	parseRewrittenPath,
	rewrittenPath,
	ImageError,
	type ObjectStore
} from "@helios/core";
import { ImageHttpError } from "./errors";
import { renderVariant } from "./render";

export interface ImageEvent {
	rawPath: string;
	rawQueryString?: string;
}

export interface ImageResponse {
	statusCode: number;
	headers?: Record<string, string>;
	body?: string;
	isBase64Encoded?: boolean;
}

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

const INLINE_RESPONSE_LIMIT_CHARS = 6 * 1024 * 1024 - 64 * 1024;

export async function handler(event: ImageEvent): Promise<ImageResponse> {
	try {
		return await serve(event);
	} catch (err) {
		if (err instanceof ImageError) {
			return errorResponse(400, err.code);
		}
		if (err instanceof ImageHttpError) {
			return errorResponse(err.status, err.code);
		}
		throw err;
	}
}

async function serve({ rawPath, rawQueryString }: ImageEvent): Promise<ImageResponse> {
	const { key, transform } = parseRewrittenPath(rawPath);
	const store = objectStore();
	const { IMAGE_MAX_SOURCE_BYTES, IMAGE_MAX_INPUT_PIXELS } = config();
	const original = await store.objectInfo(key);
	if (original === undefined) {
		throw new ImageHttpError(404, "not_found");
	}
	if (original.size > IMAGE_MAX_SOURCE_BYTES) {
		throw new ImageHttpError(413, "source_too_large");
	}
	const rendered = await renderVariant(await store.downloadBuffer(key), transform, IMAGE_MAX_INPUT_PIXELS);
	const variantKey = `resize_cache${rewrittenPath(key, transform)}`;
	await store.uploadBuffer(variantKey, rendered.body, rendered.contentType, IMMUTABLE_CACHE_CONTROL);
	await assertOriginalUnchanged(store, key, original.etag, variantKey);
	const encoded = rendered.body.toString("base64");
	if (encoded.length > INLINE_RESPONSE_LIMIT_CHARS) {
		const query = rawQueryString ? `?${rawQueryString}` : "";
		return {
			statusCode: 302,
			headers: { location: `${canonicalPath(key, transform)}${query}`, "cache-control": "no-store" }
		};
	}
	return {
		statusCode: 200,
		isBase64Encoded: true,
		headers: { "content-type": rendered.contentType, "cache-control": IMMUTABLE_CACHE_CONTROL },
		body: encoded
	};
}

async function assertOriginalUnchanged(
	store: ObjectStore,
	key: string,
	etag: string,
	variantKey: string
): Promise<void> {
	if ((await store.objectInfo(key))?.etag === etag) {
		return;
	}
	await store.deleteKeys([variantKey]);
	throw new ImageHttpError(404, "not_found");
}

function errorResponse(statusCode: number, code: string): ImageResponse {
	return {
		statusCode,
		headers: { "content-type": "application/json", "cache-control": "no-store" },
		body: JSON.stringify({ error: code })
	};
}
