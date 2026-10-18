import type { RequestError } from "@helios/contracts";
import { finalizeRequest } from "./finalizeRequest";
import { loadRequest } from "./loadRequest";
import { isOpenRequest } from "./types";

export async function failRequest(requestId: string, error: RequestError): Promise<void> {
	const request = await loadRequest(requestId);
	if (!isOpenRequest(request.status)) {
		return;
	}
	await finalizeRequest(request, new Date(), { status: "ERROR", error });
}
