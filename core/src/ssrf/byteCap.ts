import { Transform } from "node:stream";
import { ResponseTooLargeError } from "./errors";

export function byteCap(maxBytes: number): Transform {
	let total = 0;
	return new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			total += chunk.length;
			if (total > maxBytes) {
				callback(new ResponseTooLargeError(maxBytes));
				return;
			}
			callback(null, chunk);
		}
	});
}
