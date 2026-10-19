import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { config } from "../config";
import { CloudFrontCdn } from "./cloudFrontCdn";
import { RecordingCdn } from "./recordingCdn";
import type { Cdn } from "./types";

let adapter: Cdn | undefined;

export function cdn(): Cdn {
	if (adapter === undefined) {
		const settings = config();
		adapter =
			settings.CDN_MODE === "cloudfront"
				? new CloudFrontCdn(new CloudFrontClient({ region: "us-east-1" }), settings.CDN_DISTRIBUTION_ID)
				: new RecordingCdn();
	}
	return adapter;
}

export function resetCdnForTests(): void {
	adapter = undefined;
}
