import { config } from "../config";

export function cdnUrl(key: string, version?: number): string {
	const url = `${config().CDN_BASE_URL}/${key}`;
	return version === undefined ? url : `${url}?v=${version}`;
}
