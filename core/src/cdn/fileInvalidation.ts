import path from "node:path";
import { enqueueInvalidation } from "./invalidationQueue";
import { prefixPath } from "./paths";

export async function invalidateFileKey(key: string, callerReference: string): Promise<void> {
	await enqueueInvalidation([prefixPath(`${path.posix.dirname(key)}/`)], callerReference);
}
