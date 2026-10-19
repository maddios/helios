import { EVENTBRIDGE_BUS_ARN_PATTERN, ValidationError } from "@helios/contracts";
import { config } from "../config";

export class InvalidEventBusArnError extends ValidationError {
	constructor(reason: string) {
		super(`eventBusArn ${reason}`, undefined, "invalid_event_bus_arn");
	}
}

const BUS_PREFIX = "event-bus/";

export interface ParsedEventBusArn {
	region: string;
	accountId: string;
	busName: string;
}

export function parseEventBusArn(eventBusArn: string): ParsedEventBusArn {
	if (!EVENTBRIDGE_BUS_ARN_PATTERN.test(eventBusArn)) {
		throw new InvalidEventBusArnError("must be an EventBridge event bus ARN");
	}
	const [, , , region, accountId, resource] = eventBusArn.split(":") as [
		string,
		string,
		string,
		string,
		string,
		string
	];
	if (accountId === config().HELIOS_AWS_ACCOUNT_ID) {
		throw new InvalidEventBusArnError("must be a bus in your AWS account, not Helios's");
	}
	return { region, accountId, busName: resource.slice(BUS_PREFIX.length) };
}
