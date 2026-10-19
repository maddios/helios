import { eventbridgeGuide, webhooksGuide } from "../index";

describe("guides", () => {
	it("exports the guide text, including the EventBridge policy endpoint", () => {
		expect(webhooksGuide.length).toBeGreaterThan(0);
		expect(eventbridgeGuide).toContain("/destinations/eventbridge/policy");
	});
});
