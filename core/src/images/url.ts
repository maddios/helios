import { config } from "../config";
import { canonicalPath } from "./routes";
import { assertTransformableKey } from "./transformableKey";
import type { ImageTransform } from "./types";

export function imageUrl(key: string, transform: ImageTransform, version?: number): string {
	assertTransformableKey(key);
	const url = `${config().IMAGE_BASE_URL}${canonicalPath(key, transform)}`;
	return version === undefined ? url : `${url}?v=${version}`;
}
