import type { Destination } from "@helios/contracts";
import { resolveDestination } from "../../src/callbacks";
import type { Account, PipelineRequest } from "../../src/models";

const requestDestination: Destination = { type: "webhook", url: "https://93.184.216.34/request" };
const accountDestination: Destination = { type: "webhook", url: "https://93.184.216.34/account" };

function accountWith(destination?: Destination): Account {
	return {
		_id: "account-1",
		slug: "acme",
		name: "Acme",
		sourceBuckets: [],
		webhookSecret: "whsec_test",
		features: { peopleAttributes: false },
		createdAt: new Date(),
		...(destination !== undefined && { destination })
	};
}

function requestWith(destination?: Destination): PipelineRequest {
	return {
		_id: "req-1",
		accountId: "account-1",
		assetId: "asset-1",
		clientRequestId: "req-1",
		mode: "purge",
		analyze: "sync",
		assetVersion: 1,
		pendingItems: [],
		status: "COMPLETE",
		createdAt: new Date(),
		...(destination !== undefined && { destination })
	};
}

describe("resolveDestination", () => {
	it("prefers the request destination over the account destination", () => {
		expect(resolveDestination(requestWith(requestDestination), accountWith(accountDestination))).toEqual(
			requestDestination
		);
	});

	it("falls back to the account destination when the request has none", () => {
		expect(resolveDestination(requestWith(), accountWith(accountDestination))).toEqual(accountDestination);
	});

	it("returns undefined when neither the request nor the account has a destination", () => {
		expect(resolveDestination(requestWith(), accountWith())).toBeUndefined();
	});
});
