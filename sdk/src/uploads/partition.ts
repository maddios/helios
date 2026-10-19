import { toBuffer } from "./input.js";

/**
 * Re-cuts a stream of chunks into parts of exactly `partSizeBytes`, except the last one.
 *
 * @param chunks The source bytes, in order.
 * @param partSizeBytes Size of each part.
 * @yields Each part as a Buffer, in order.
 */
export async function* partitionChunks(
	chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
	partSizeBytes: number
): AsyncGenerator<Buffer> {
	let pending: Buffer[] = [];
	let pendingBytes = 0;
	for await (const chunk of chunks) {
		let rest = toBuffer(chunk);
		while (rest.byteLength > 0) {
			const take = Math.min(partSizeBytes - pendingBytes, rest.byteLength);
			pending.push(rest.subarray(0, take));
			pendingBytes += take;
			rest = rest.subarray(take);
			if (pendingBytes === partSizeBytes) {
				yield Buffer.concat(pending);
				pending = [];
				pendingBytes = 0;
			}
		}
	}
	if (pendingBytes > 0) {
		yield Buffer.concat(pending);
	}
}
