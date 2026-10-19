import type { CallbackDeliveryView } from "@helios/contracts";
import type { CallbackDelivery } from "@helios/core";

export function toCallbackView(delivery: CallbackDelivery): CallbackDeliveryView {
	return {
		id: delivery._id,
		requestId: delivery.requestId,
		event: delivery.event,
		status: delivery.status,
		...(delivery.destinationType !== undefined && { destinationType: delivery.destinationType }),
		attempts: delivery.attempts.map((attempt) => ({
			at: attempt.at.toISOString(),
			status: attempt.status,
			...(attempt.httpStatus !== undefined && { httpStatus: attempt.httpStatus }),
			...(attempt.error !== undefined && { error: attempt.error })
		})),
		...(delivery.deliveredAt !== undefined && { deliveredAt: delivery.deliveredAt.toISOString() }),
		createdAt: delivery.createdAt.toISOString()
	};
}
