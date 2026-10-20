import type { PutOptions } from "../transport/transport.js";
import type {
	CompleteUploadRequest,
	CompleteUploadResponse,
	CreateUploadRequest,
	CreateUploadResponse
} from "../types.js";

/** The upload operations the orchestration needs, so it stays independent of HTTP. */
export interface UploadApi {
	create(request: CreateUploadRequest, signal?: AbortSignal): Promise<CreateUploadResponse>;
	complete(fileId: string, request: CompleteUploadRequest, signal?: AbortSignal): Promise<CompleteUploadResponse>;
	abort(fileId: string): Promise<void>;
	putObject(url: string, body: Uint8Array, options: PutOptions): Promise<string | null>;
}
