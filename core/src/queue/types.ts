export interface OutgoingMessage<T> {
	body: T;
	groupId?: string;
	deduplicationId?: string;
	attributes?: Record<string, string>;
}

export interface ReceivedMessage<T> {
	id: string;
	receiptHandle: string;
	body: T;
	attributes: Record<string, string>;
	groupId?: string;
	receiveCount: number;
}

export interface Queue<T = unknown> {
	send(message: OutgoingMessage<T>): Promise<void>;
	sendBatch(messages: OutgoingMessage<T>[]): Promise<void>;
	poll(
		maxMessages: number,
		waitTimeSeconds: number,
		visibilityTimeoutSeconds?: number,
		signal?: AbortSignal
	): Promise<ReceivedMessage<T>[]>;
	ack(message: ReceivedMessage<T>): Promise<void>;
	changeVisibility(message: ReceivedMessage<T>, seconds: number): Promise<void>;
}
