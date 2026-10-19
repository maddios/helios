import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import type { Readable } from "node:stream";
import { ValidationError } from "../errors.js";

/**
 * What the upload methods accept: a local file path, a Buffer, a readable stream or a Blob.
 *
 * Paths and Buffers carry their size; streams need `sizeBytes`; Buffers, streams and Blobs need `filename`.
 */
export type UploadInput = string | Buffer | Readable | Blob;

/** Options that describe an input. */
export interface SourceOptions {
	/** Name stored with the upload. Defaults to the basename of a path; required for other inputs. */
	filename?: string;
	/** Size in bytes; required for stream inputs, detected for every other kind. */
	sizeBytes?: number;
}

/** A normalised input: its name, its exact size and its bytes in order. */
export interface Source {
	filename: string;
	sizeBytes: number;
	chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}

/**
 * Detects the size of an input and exposes its bytes as a stream of chunks.
 *
 * @param input The file path, Buffer, readable stream or Blob.
 * @param options Filename and size overrides.
 * @returns The normalised source.
 * @throws {ValidationError} When a filename or a stream size is missing.
 */
export async function openSource(input: UploadInput, options: SourceOptions): Promise<Source> {
	if (typeof input === "string") {
		const { size } = await stat(input);
		return { filename: options.filename ?? basename(input), sizeBytes: size, chunks: createReadStream(input) };
	}
	const filename = requireFilename(options.filename);
	if (Buffer.isBuffer(input)) {
		return { filename, sizeBytes: input.byteLength, chunks: [input] };
	}
	if (input instanceof Blob) {
		return { filename, sizeBytes: input.size, chunks: input.stream() };
	}
	return { filename, sizeBytes: requireSize(options.sizeBytes), chunks: input };
}

function requireFilename(filename: string | undefined): string {
	if (filename === undefined) {
		throw new ValidationError("filename_required", "filename is required for Buffer, stream and Blob inputs");
	}
	return filename;
}

function requireSize(sizeBytes: number | undefined): number {
	if (sizeBytes === undefined) {
		throw new ValidationError("size_required", "sizeBytes is required for stream inputs");
	}
	return sizeBytes;
}

/**
 * Copies a chunk into a Buffer view without copying its bytes.
 *
 * @param chunk Bytes from a file, stream or Blob.
 * @returns A Buffer over the same memory.
 */
export function toBuffer(chunk: Uint8Array): Buffer {
	return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}
