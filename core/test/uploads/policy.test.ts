import { ValidationError, type UploadPolicy } from "@helios/contracts";
import { matchesPattern, resolveUploadPolicy, storedViolationOf, violationOf } from "../../src/policy";
import type { Account } from "../../src/models";

const MB = 1024 * 1024;
const account = (uploadPolicy?: UploadPolicy) => ({ uploadPolicy }) as Account;
const narrowAccount = account({ allowedContentTypes: ["image/*", "video/mp4"], maxBytes: 100 * MB });

describe("matchesPattern", () => {
	it.each([
		["*/*", "application/pdf", true],
		["image/*", "image/png", true],
		["image/*", "video/mp4", false],
		["video/mp4", "video/mp4", true],
		["video/mp4", "video/webm", false],
		["image/*", "*/*", false]
	])("matches %s against %s as %s", (pattern, contentType, expected) => {
		expect(matchesPattern(pattern, contentType)).toBe(expected);
	});
});

describe("resolveUploadPolicy", () => {
	it("applies the default policy when the account has none and the request names none", () => {
		expect(resolveUploadPolicy(account(), undefined)).toEqual({
			allowedContentTypes: ["*/*"],
			maxBytes: Number(process.env.MAX_UPLOAD_BYTES)
		});
	});

	it("lets a request narrow the account policy", () => {
		const narrower = { allowedContentTypes: ["image/png"], maxBytes: 10 * MB };

		expect(resolveUploadPolicy(narrowAccount, narrower)).toEqual(narrower);
	});

	it("rejects a request that adds a content type the account does not allow", () => {
		const widened = { allowedContentTypes: ["application/pdf"], maxBytes: 10 * MB };

		expect(() => resolveUploadPolicy(narrowAccount, widened)).toThrow(ValidationError);
		expect(() => resolveUploadPolicy(narrowAccount, widened)).toThrow(/cannot widen/);
	});

	it("rejects a request that raises maxBytes above the account policy", () => {
		const widened = { allowedContentTypes: ["image/png"], maxBytes: 200 * MB };

		expect(() => resolveUploadPolicy(narrowAccount, widened)).toThrow(/maxBytes/);
	});

	it("accepts a wildcard the account already covers", () => {
		const narrower = { allowedContentTypes: ["image/jpeg"], maxBytes: 100 * MB };

		expect(() => resolveUploadPolicy(narrowAccount, narrower)).not.toThrow();
	});
});

describe("violationOf and storedViolationOf", () => {
	const policy = { allowedContentTypes: ["image/*"], maxBytes: 10 * MB };
	const PNG_CANDIDATES = ["image/png", "image/apng"];

	it("reports a candidate type the policy does not allow", () => {
		expect(violationOf(policy, { candidates: ["video/mp4"], sizeBytes: 1 })).toMatch(/not allowed/);
	});

	it("allows the bytes when any of their candidate types is allowed", () => {
		const webm = { candidates: ["video/x-matroska", "video/webm"], sizeBytes: 1 };
		expect(violationOf({ allowedContentTypes: ["video/webm"], maxBytes: 10 * MB }, webm)).toBeUndefined();
		expect(violationOf({ allowedContentTypes: ["video/x-matroska"], maxBytes: 10 * MB }, webm)).toBeUndefined();
	});

	it("reports a file over maxBytes", () => {
		expect(violationOf(policy, { candidates: PNG_CANDIDATES, sizeBytes: 11 * MB })).toMatch(/larger than/);
	});

	it("reports stored bytes that are text when the file was declared as a png", () => {
		expect(
			storedViolationOf(
				{ allowedContentTypes: ["*/*"], maxBytes: 10 * MB },
				{ declaredContentType: "image/png", filename: "a.png", candidates: ["text/plain"], sizeBytes: 12 }
			)
		).toMatch(/does not match the content \(text\/plain\)/);
	});

	it("does not reject a declared non-inline type whose bytes differ, since it is served as an attachment", () => {
		expect(
			storedViolationOf(
				{ allowedContentTypes: ["*/*"], maxBytes: 10 * MB },
				{ declaredContentType: "text/csv", filename: "a.csv", candidates: ["text/plain"], sizeBytes: 12 }
			)
		).toBeUndefined();
	});

	it("reports a stored size that differs from the declared size", () => {
		expect(
			storedViolationOf(policy, {
				declaredContentType: "image/png",
				declaredSizeBytes: 100,
				filename: "a.png",
				candidates: PNG_CANDIDATES,
				sizeBytes: 90
			})
		).toMatch(/does not match the declared size/);
	});

	it("accepts stored bytes that match the declared type and size", () => {
		expect(
			storedViolationOf(policy, {
				declaredContentType: "image/png",
				declaredSizeBytes: 100,
				filename: "a.png",
				candidates: PNG_CANDIDATES,
				sizeBytes: 100
			})
		).toBeUndefined();
	});
});
