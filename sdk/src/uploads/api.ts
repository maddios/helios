import type {
	MultipartCompleteRequest,
	MultipartCompleteResponse,
	MultipartCreateRequest,
	MultipartCreateResponse,
	PresignedUploadRequest,
	PresignedUploadResponse
} from "@helios/contracts";
import type { PutOptions } from "../transport/transport.js";

/** The upload operations the orchestration needs, so it stays independent of HTTP. */
export interface UploadApi {
	presign(request: PresignedUploadRequest, signal?: AbortSignal): Promise<PresignedUploadResponse>;
	createMultipart(request: MultipartCreateRequest, signal?: AbortSignal): Promise<MultipartCreateResponse>;
	completeMultipart(
		uploadId: string,
		request: MultipartCompleteRequest,
		signal?: AbortSignal
	): Promise<MultipartCompleteResponse>;
	abortMultipart(uploadId: string, uploadKey: string): Promise<void>;
	putObject(url: string, body: Uint8Array, options: PutOptions): Promise<string | null>;
}
