import { ImageError } from "./errors";

const KEY_PATTERN = /^[a-z0-9-]+\/(media|files)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const DENIED_SEGMENTS = ["sources", "uploads", ".", ".."];

export function isTransformableKey(key: string): boolean {
	const segments = key.split("/");
	return KEY_PATTERN.test(key) && !segments.some((segment) => DENIED_SEGMENTS.includes(segment));
}

export function assertTransformableKey(key: string): void {
	if (!isTransformableKey(key)) {
		throw new ImageError("invalid_key", `Image key "${key}" is not transformable`);
	}
}
