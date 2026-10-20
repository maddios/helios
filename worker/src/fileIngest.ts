import { contextLogger, ingestFileFromUrl, type FileIngestMessage, type ItemMessage } from "@helios/core";

export type WorkerMessage = ItemMessage | FileIngestMessage;

export function isFileIngest(body: WorkerMessage): body is FileIngestMessage {
	return "fileId" in body;
}

export async function runFileIngest(fileId: string, signal: AbortSignal): Promise<"done" | "redeliver"> {
	try {
		await ingestFileFromUrl(fileId, { signal });
		return "done";
	} catch (err) {
		contextLogger({}).error({ err, fileId }, "File ingest failed; message left for redelivery");
		return "redeliver";
	}
}
