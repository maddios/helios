import type { UploadProgress } from "./types.js";

/**
 * Sums the bytes of each part and reports the total. A part keeps the highest count it reported, so a retried part
 * does not move the total backwards.
 */
export class ProgressTracker {
	private readonly loaded = new Map<number, number>();
	private uploadedBytes = 0;

	/**
	 * @param totalBytes Size of the whole file.
	 * @param onProgress Receives the total after each change.
	 */
	constructor(
		private readonly totalBytes: number,
		private readonly onProgress?: (progress: UploadProgress) => void
	) {}

	/**
	 * Records the bytes of a part so far.
	 *
	 * @param partNumber The part.
	 * @param loadedBytes Bytes of the part sent so far.
	 */
	update(partNumber: number, loadedBytes: number): void {
		const previous = this.loaded.get(partNumber) ?? 0;
		if (loadedBytes <= previous) {
			return;
		}
		this.loaded.set(partNumber, loadedBytes);
		this.uploadedBytes += loadedBytes - previous;
		this.onProgress?.({ uploadedBytes: this.uploadedBytes, totalBytes: this.totalBytes });
	}
}
