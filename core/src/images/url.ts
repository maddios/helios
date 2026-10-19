import { checkedCanonicalPath, type ImageTransform } from "@helios/contracts";
import { config } from "../config";

export function imageUrl(key: string, transform: ImageTransform, version?: number): string {
	const url = `${config().IMAGE_BASE_URL}${checkedCanonicalPath(key, transform)}`;
	return version === undefined ? url : `${url}?v=${version}`;
}
