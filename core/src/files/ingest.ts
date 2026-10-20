import { HeliosError, UnprocessableError } from "@helios/contracts";
import { Readable } from "node:stream";
import { safeFetch } from "../ssrf";
import { objectStore } from "../storage";
import { files, type FileRecord } from "../models";
import { contentTypeViolationOf, contentDispositionFor, storedViolationOf } from "../policy";
import { releaseFileObjects } from "./release";
import { notifyFileEvent } from "./queues";
import { markFailed, markStored, type StoredContent } from "./transitions";
import { SNIFF_BYTES, sniffHead } from "./sniff";

const MAX_REDIRECTS = 5;

export interface IngestOptions {
	signal?: AbortSignal;
}

/**
 * Fetches a from-url file into storage, then claims it as stored or failed. An abort is not a failure: it propagates
 * so the message is redelivered.
 */
export async function ingestFileFromUrl(fileId: string, options: IngestOptions = {}): Promise<void> {
	const file = await files().findOne({ _id: fileId });
	if (file === null || file.status !== "PENDING" || file.deletedAt !== undefined || file.sourceUrl === undefined) {
		return;
	}
	try {
		const stored = await fetchIntoStorage(file, file.sourceUrl, options.signal);
		if ((await markStored(file, stored)) === undefined) {
			await releaseFileObjects(file);
			return;
		}
		await notifyFileEvent(fileId, file.accountId, "file.stored");
	} catch (err) {
		if (!(err instanceof HeliosError)) {
			throw err;
		}
		const claimed = await markFailed(file, err.message);
		await releaseFileObjects(file);
		if (claimed) {
			await notifyFileEvent(fileId, file.accountId, "file.failed");
		}
	}
}

async function fetchIntoStorage(file: FileRecord, url: string, signal?: AbortSignal): Promise<StoredContent> {
	const response = await safeFetch(url, { maxBytes: file.policy.maxBytes, maxRedirects: MAX_REDIRECTS, signal });
	const { head, body } = await peek(response.body, SNIFF_BYTES);
	const sniffed = sniffHead(head);
	const reason = contentTypeViolationOf(file.policy, sniffed.candidates);
	if (reason !== undefined) {
		body.destroy();
		throw new UnprocessableError(reason, undefined, "policy_violation");
	}
	const sizeBytes = await objectStore().uploadStream(file.key, body, {
		contentType: sniffed.contentType,
		contentDisposition: contentDispositionFor(sniffed.contentType),
		...(signal !== undefined && { signal })
	});
	const violation = storedViolationOf(file.policy, {
		filename: file.filename,
		candidates: sniffed.candidates,
		sizeBytes
	});
	if (violation !== undefined) {
		throw new UnprocessableError(violation, undefined, "policy_violation");
	}
	return { contentType: sniffed.contentType, sizeBytes, ...(sniffed.image !== undefined && { image: sniffed.image }) };
}

async function peek(body: Readable, bytes: number): Promise<{ head: Buffer; body: Readable }> {
	const iterator = body[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
	const chunks: Buffer[] = [];
	let length = 0;
	while (length < bytes) {
		const next = await iterator.next();
		if (next.done === true) {
			break;
		}
		chunks.push(next.value);
		length += next.value.length;
	}
	const head = Buffer.concat(chunks);
	return { head, body: Readable.from(replay(head, iterator), { objectMode: false }) };
}

async function* replay(head: Buffer, rest: AsyncIterator<Buffer>): AsyncGenerator<Buffer> {
	yield head;
	for (let next = await rest.next(); next.done !== true; next = await rest.next()) {
		yield next.value;
	}
}
