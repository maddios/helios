import { ConflictError, type EncodeOptions } from "@helios/contracts";
import { createEncode } from "../intake";
import { requests, type Account, type FileRecord, type PipelineRequest } from "../models";
import { resolvePostProcess } from "../pipeline";

/**
 * Encodes a stored file. Repeating the request id returns the request it created, but only with the same options:
 * a different preset, analyze mode, destination or post-process is a 409 complete_conflict.
 */
export async function encodeUploadedFile(
	account: Account,
	file: FileRecord,
	encode: EncodeOptions
): Promise<Awaited<ReturnType<typeof createEncode>>> {
	const requestId = encode.requestId ?? file._id;
	const existing = await requests().findOne({ accountId: account._id, clientRequestId: requestId });
	if (existing !== null && !sameEncodeOptions(existing, encode)) {
		throw new ConflictError(
			`Request ${requestId} was created with different encode options; use encodes.create({ source: { fileId } }) for additional encodes`,
			{ requestId },
			"complete_conflict"
		);
	}
	return createEncode(account, { ...encode, source: { fileId: file._id }, requestId });
}

function sameEncodeOptions(request: PipelineRequest, encode: EncodeOptions): boolean {
	if (request.presetSnapshot === undefined || request.presetSnapshot.name !== encode.preset) {
		return false;
	}
	const postProcess = resolvePostProcess(encode.postProcess, request.presetSnapshot.postProcess);
	return (
		request.analyze === encode.analyze &&
		JSON.stringify(request.destination ?? null) === JSON.stringify(encode.destination ?? null) &&
		JSON.stringify(request.postProcess) === JSON.stringify(postProcess)
	);
}
