import { Helios } from "@partnrup/helios-sdk";
import { requireEnv } from "./requireEnv.js";

const helios = new Helios({
	apiKey: requireEnv("HELIOS_API_KEY"),
	baseUrl: requireEnv("HELIOS_BASE_URL")
});

const eventBusArn = requireEnv("EVENT_BUS_ARN");

const { policy, command } = await helios.destinations.eventBridgePolicy(eventBusArn);
console.log(command, policy);

const test = await helios.destinations.test({ type: "eventbridge", eventBusArn });
if (!test.ok) {
	throw new Error(`${test.error?.code}: ${test.error?.hint}`);
}

await helios.account.setDestination({ type: "eventbridge", eventBusArn });
