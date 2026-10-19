const BACKOFF_SEC = [30, 120, 600, 1800, 7200];

export class CallbackDeliveryError extends Error {
	constructor(
		message: string,
		readonly backoffSec: number
	) {
		super(message);
		this.name = new.target.name;
	}
}

export class PayloadTooLargeError extends Error {
	constructor(readonly bytes: number) {
		super(`Payload is ${bytes} bytes, above the delivery limit`);
		this.name = new.target.name;
	}
}

export function backoffSec(receiveCount: number): number {
	return BACKOFF_SEC[Math.min(receiveCount, BACKOFF_SEC.length) - 1];
}
