import { config } from "../config";
import { parseEventBusArn } from "./eventBusArn";

export function eventSourceFor(accountId: string): string {
	return `helios.${accountId}`;
}

export function eventBridgePolicy(eventBusArn: string, accountId: string): { policy: object; command: string } {
	const { region, busName } = parseEventBusArn(eventBusArn);
	const { HELIOS_AWS_ACCOUNT_ID } = config();
	const sid = `helios-${accountId}`;
	return {
		policy: {
			Version: "2012-10-17",
			Statement: [
				{
					Sid: sid,
					Effect: "Allow",
					Principal: { AWS: `arn:aws:iam::${HELIOS_AWS_ACCOUNT_ID}:root` },
					Action: "events:PutEvents",
					Resource: eventBusArn,
					Condition: { StringEquals: { "events:source": eventSourceFor(accountId) } }
				}
			]
		},
		command: `aws events put-permission --region ${region} --event-bus-name ${busName} --policy file://policy.json`
	};
}
