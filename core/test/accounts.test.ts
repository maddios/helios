import { ConflictError, NotFoundError, ValidationError } from "@helios/contracts";
import { accounts, ensureIndexes } from "../src/models";
import { createAccount, getAccount, listAccounts, rotateWebhookSecret, updateAccount } from "../src/accounts";
import { config } from "../src/config";
import { UnsafeUrlError } from "../src/ssrf";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";
const BUS_ARN = "arn:aws:events:us-east-2:123456789012:event-bus/helios";
const baseInput = { slug: "acme", name: "Acme", sourceBuckets: ["bucket-a"], features: { peopleAttributes: false } };

beforeAll(() => startMongo());
afterAll(() => stopMongo());
beforeEach(async () => {
	await resetDb();
	await ensureIndexes();
});

describe("createAccount", () => {
	it("returns and stores a whsec_ webhook secret of 38 characters", async () => {
		const account = await createAccount(baseInput);

		expect(account.webhookSecret).toMatch(/^whsec_[0-9A-Za-z]{32}$/);
		expect(account.webhookSecret).toHaveLength(38);
		expect(account.slug).toBe("acme");
		expect((await getAccount(account._id)).webhookSecret).toBe(account.webhookSecret);
	});

	it("rejects a duplicate slug with ConflictError", async () => {
		await createAccount(baseInput);

		await expect(createAccount(baseInput)).rejects.toThrow(ConflictError);
	});

	it("throws and inserts nothing when the webhook destination is private", async () => {
		const destination = { type: "webhook" as const, url: "http://10.0.0.1/hook" };

		await expect(createAccount({ ...baseInput, slug: "blocked", destination })).rejects.toMatchObject({
			code: "unsafe_url",
			httpStatus: 400
		});
		await expect(createAccount({ ...baseInput, slug: "blocked", destination })).rejects.toBeInstanceOf(UnsafeUrlError);
		expect(await accounts().countDocuments({ slug: "blocked" })).toBe(0);
	});

	it("stores an eventbridge destination whose ARN is a bus ARN", async () => {
		const destination = { type: "eventbridge" as const, eventBusArn: BUS_ARN };

		const account = await createAccount({ ...baseInput, destination });

		expect((await getAccount(account._id)).destination).toEqual(destination);
	});

	it("throws and inserts nothing when the eventbridge ARN is not a bus ARN", async () => {
		const destination = { type: "eventbridge" as const, eventBusArn: "arn:aws:sqs:us-east-2:123456789012:queue" };

		await expect(createAccount({ ...baseInput, slug: "bad-arn", destination })).rejects.toThrow(ValidationError);
		expect(await accounts().countDocuments({ slug: "bad-arn" })).toBe(0);
	});

	it("rejects the media bucket in sourceBuckets and inserts nothing", async () => {
		await expect(createAccount({ ...baseInput, sourceBuckets: [config().MEDIA_BUCKET] })).rejects.toThrow(
			ValidationError
		);
		expect(await accounts().countDocuments({ slug: "acme" })).toBe(0);
	});
});

describe("getAccount", () => {
	it("throws NotFoundError for an unknown id", async () => {
		await expect(getAccount(UNKNOWN_ID)).rejects.toThrow(NotFoundError);
	});
});

describe("updateAccount", () => {
	it("changes the name and merges features without touching sourceBuckets", async () => {
		const account = await createAccount(baseInput);

		const updated = await updateAccount(account._id, { name: "Acme Inc", features: { peopleAttributes: true } });

		expect(updated.name).toBe("Acme Inc");
		expect(updated.features.peopleAttributes).toBe(true);
		expect(updated.sourceBuckets).toEqual(["bucket-a"]);
	});

	it("throws NotFoundError for an unknown id", async () => {
		await expect(updateAccount(UNKNOWN_ID, { name: "Nobody" })).rejects.toThrow(NotFoundError);
	});

	it("rejects the media bucket in sourceBuckets and leaves the account unchanged", async () => {
		const account = await createAccount(baseInput);

		await expect(updateAccount(account._id, { sourceBuckets: [config().MEDIA_BUCKET] })).rejects.toThrow(
			ValidationError
		);
		expect((await getAccount(account._id)).sourceBuckets).toEqual(["bucket-a"]);
	});

	it("sets a new webhook destination after checking it is public", async () => {
		const account = await createAccount(baseInput);

		const updated = await updateAccount(account._id, {
			destination: { type: "webhook", url: "https://93.184.216.34/hook" }
		});

		expect(updated.destination).toEqual({ type: "webhook", url: "https://93.184.216.34/hook" });
	});

	it("sets an eventbridge destination", async () => {
		const account = await createAccount(baseInput);

		const updated = await updateAccount(account._id, { destination: { type: "eventbridge", eventBusArn: BUS_ARN } });

		expect(updated.destination).toEqual({ type: "eventbridge", eventBusArn: BUS_ARN });
	});

	it("clears the destination when null is given", async () => {
		const account = await createAccount({
			...baseInput,
			destination: { type: "webhook", url: "https://93.184.216.34/hook" }
		});

		const updated = await updateAccount(account._id, { destination: null });

		expect(updated.destination).toBeUndefined();
		expect((await getAccount(account._id)).destination).toBeUndefined();
	});

	it("leaves the stored destination unchanged when assertPublicUrl rejects the new one", async () => {
		const account = await createAccount({
			...baseInput,
			destination: { type: "webhook", url: "https://93.184.216.34/hook" }
		});

		await expect(
			updateAccount(account._id, { destination: { type: "webhook", url: "http://10.0.0.1/hook" } })
		).rejects.toThrow(UnsafeUrlError);
		expect((await getAccount(account._id)).destination).toEqual({
			type: "webhook",
			url: "https://93.184.216.34/hook"
		});
	});
});

describe("rotateWebhookSecret", () => {
	it("returns and persists a new secret that differs from the old one", async () => {
		const account = await createAccount(baseInput);

		const rotated = await rotateWebhookSecret(account._id);

		expect(rotated).not.toBe(account.webhookSecret);
		expect((await getAccount(account._id)).webhookSecret).toBe(rotated);
	});

	it("throws NotFoundError for an unknown id", async () => {
		await expect(rotateWebhookSecret(UNKNOWN_ID)).rejects.toThrow(NotFoundError);
	});
});

describe("listAccounts", () => {
	it("returns accounts sorted by createdAt ascending", async () => {
		const later = await createAccount({ ...baseInput, slug: "later" });
		const earlier = await createAccount({ ...baseInput, slug: "earlier" });
		await accounts().updateOne({ _id: earlier._id }, { $set: { createdAt: new Date("2020-01-01T00:00:00Z") } });
		await accounts().updateOne({ _id: later._id }, { $set: { createdAt: new Date("2021-01-01T00:00:00Z") } });

		expect((await listAccounts()).map((account) => account.slug)).toEqual(["earlier", "later"]);
	});
});
