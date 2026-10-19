import { ImageError, type ImageErrorCode } from "./errors";
import { canonicalParams, checkImageTransform, parseImageParams } from "./params";
import { assertTransformableKey } from "./transformableKey";
import type { ImageTransform } from "./types";

const IMG_PREFIX = "/img/";
const REWRITE_MARKER = "/_img/";

export interface ImageRequest {
	key: string;
	transform: ImageTransform;
}

export type ImageRoute =
	{ kind: "rewrite"; uri: string } | { kind: "redirect"; location: string } | { kind: "invalid"; code: ImageErrorCode };

export function canonicalPath(key: string, transform: ImageTransform): string {
	return `${IMG_PREFIX}${canonicalParams(transform)}/${key}`;
}

/**
 * Builds the canonical path of a transform after checking the key and every value.
 *
 * @param key Transformable storage key.
 * @param transform Transform to check and canonicalise.
 * @returns The canonical `/img/<params>/<key>` path.
 * @throws {ImageError} When the key or the transform is invalid.
 */
export function checkedCanonicalPath(key: string, transform: ImageTransform): string {
	assertTransformableKey(key);
	return canonicalPath(key, checkImageTransform(transform));
}

export function rewrittenPath(key: string, transform: ImageTransform): string {
	return `/${key}${REWRITE_MARKER}${canonicalParams(transform)}`;
}

export function parseImagePath(path: string): ImageRequest {
	if (!path.startsWith(IMG_PREFIX)) {
		throw new ImageError("invalid_path", `Image path must start with ${IMG_PREFIX}`);
	}
	const rest = path.slice(IMG_PREFIX.length);
	const slash = rest.indexOf("/");
	if (slash === -1) {
		throw new ImageError("invalid_path", "Image path must be /img/<params>/<key>");
	}
	const key = rest.slice(slash + 1);
	const transform = parseImageParams(rest.slice(0, slash));
	assertTransformableKey(key);
	return { key, transform };
}

export function parseRewrittenPath(uri: string): ImageRequest {
	const marker = uri.lastIndexOf(REWRITE_MARKER);
	if (!uri.startsWith("/") || marker === -1) {
		throw new ImageError("invalid_path", "Rewritten image path must be /<key>/_img/<params>");
	}
	const key = uri.slice(1, marker);
	const segment = uri.slice(marker + REWRITE_MARKER.length);
	const transform = parseImageParams(segment);
	assertTransformableKey(key);
	if (canonicalParams(transform) !== segment) {
		throw new ImageError("non_canonical", "Image parameters must be in canonical order");
	}
	return { key, transform };
}

export function routeImageUri(uri: string): ImageRoute {
	try {
		const { key, transform } = parseImagePath(uri);
		const canonical = canonicalPath(key, transform);
		return canonical === uri
			? { kind: "rewrite", uri: rewrittenPath(key, transform) }
			: { kind: "redirect", location: canonical };
	} catch (err) {
		if (err instanceof ImageError) {
			return { kind: "invalid", code: err.code };
		}
		throw err;
	}
}
