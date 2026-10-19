import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { resetConfigForTests } from "../../src/config";
import { notifyScaler, resetNotifyForTests } from "../../src/scaler";

const lambdaMock = mockClient(LambdaClient);
const FUNCTION_NAME = "helios-test-scaler";
const MIN_INTERVAL_MS = 1000;

describe("notifyScaler", () => {
	const original = process.env;

	function configure(overrides: Record<string, string>): void {
		process.env = { ...original, ...overrides };
		resetConfigForTests();
	}

	function invocations(): unknown[] {
		return lambdaMock.commandCalls(InvokeCommand).map((call) => call.args[0].input);
	}

	beforeEach(() => {
		lambdaMock.reset();
		lambdaMock.on(InvokeCommand).resolves({});
		resetNotifyForTests();
		configure({
			SCALER_NOTIFY: "lambda",
			SCALER_FUNCTION_NAME: FUNCTION_NAME,
			SCALER_NOTIFY_MIN_INTERVAL_MS: String(MIN_INTERVAL_MS)
		});
	});

	afterEach(() => {
		jest.useRealTimers();
		process.env = original;
		resetConfigForTests();
	});

	it("does nothing when notifications are off", async () => {
		configure({ SCALER_NOTIFY: "none" });

		await notifyScaler();

		expect(invocations()).toEqual([]);
	});

	it("invokes the scaler function asynchronously", async () => {
		await notifyScaler();

		expect(invocations()).toEqual([{ FunctionName: FUNCTION_NAME, InvocationType: "Event" }]);
	});

	it("invokes at most once within the minimum interval", async () => {
		jest.useFakeTimers({ now: 0 });

		await notifyScaler();
		await notifyScaler();
		jest.setSystemTime(MIN_INTERVAL_MS - 1);
		await notifyScaler();

		expect(invocations()).toHaveLength(1);
	});

	it("invokes again once the minimum interval has passed", async () => {
		jest.useFakeTimers({ now: 0 });

		await notifyScaler();
		jest.setSystemTime(MIN_INTERVAL_MS);
		await notifyScaler();

		expect(invocations()).toHaveLength(2);
	});

	it("never throws when the invoke fails", async () => {
		lambdaMock.on(InvokeCommand).rejects(new Error("Throttling"));

		await expect(notifyScaler()).resolves.toBeUndefined();

		expect(invocations()).toHaveLength(1);
	});
});
