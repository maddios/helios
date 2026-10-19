import type { Cdn } from "./types";

export class RecordingCdn implements Cdn {
	async invalidationsInProgress(): Promise<number> {
		return 0;
	}

	async createInvalidation(): Promise<boolean> {
		return true;
	}
}
