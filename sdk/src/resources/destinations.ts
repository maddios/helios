import type { Destination, DestinationTestResult, EventBridgePolicyResponse } from "@helios/contracts";
import type { Transport } from "../transport/transport.js";

/**
 * Tests delivery destinations and prepares EventBridge buses for Helios to write to.
 *
 * @example
 * const result = await helios.destinations.test();
 * if (!result.ok) console.error(result.error?.hint);
 */
export class Destinations {
	/**
	 * @param transport Shared HTTP transport.
	 * @internal
	 */
	constructor(private readonly transport: Transport) {}

	/**
	 * Sends a `helios.test` event to the account destination, or to a destination you pass.
	 *
	 * A failed delivery is reported in the result, not thrown; `ok` is `false` and `error` explains why.
	 *
	 * @param destination Destination to test. Defaults to the account destination.
	 * @returns The test result, with the HTTP status for webhooks.
	 * @throws {ValidationError} When the destination is invalid, e.g. a non-https webhook URL (400).
	 * @throws {RateLimitError} When a test was sent too recently (429).
	 * @example
	 * await helios.destinations.test({ type: "webhook", url: "https://bella.example/hook" });
	 */
	test(destination?: Destination): Promise<DestinationTestResult> {
		return this.transport.json<DestinationTestResult>({
			method: "POST",
			retry: "rateLimitOnly",
			path: "/destinations/test",
			body: destination === undefined ? {} : { destination }
		});
	}

	/**
	 * Gets the resource policy and the AWS CLI command that let Helios put events on a customer bus.
	 *
	 * @param eventBusArn ARN of the customer event bus.
	 * @returns The policy document and the AWS CLI command that attaches it.
	 * @throws {ValidationError} When the ARN is not an EventBridge bus ARN (400).
	 * @example
	 * const { command } = await helios.destinations.eventBridgePolicy("arn:aws:events:us-east-2:123456789012:event-bus/bella");
	 */
	eventBridgePolicy(eventBusArn: string): Promise<EventBridgePolicyResponse> {
		return this.transport.json<EventBridgePolicyResponse>({
			method: "GET",
			retry: "idempotent",
			path: "/destinations/eventbridge/policy",
			query: { eventBusArn }
		});
	}
}
