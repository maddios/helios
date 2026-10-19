import { imageUrl } from "../../core/src/images/index.js";
import { routeImageUri, type ImageTransform as CoreTransform } from "../../contracts/src/index.js";
import { INVALID_TRANSFORMS, SHARED_KEY, VALID_TRANSFORMS } from "../../contracts/test/images/sharedTable.js";
import { handler as edgeHandler } from "../../infra/edge/imgRewrite.js";
import { ConfigurationError, Images, ValidationError, type ImageTransform } from "../src/index.js";

const BASE = "https://img.test.invalid";
const images = new Images(BASE);

const toSdk = (transform: CoreTransform): ImageTransform => transform;

function pathOf(url: string): string {
	return new URL(url).pathname;
}

function edgeRewrite(path: string): string | undefined {
	const result = edgeHandler({ request: { method: "GET", uri: path, querystring: {}, headers: {} } });
	return "uri" in result ? result.uri : undefined;
}

describe("images.url parity: SDK, core and the edge function", () => {
	it.each(VALID_TRANSFORMS)("%s builds the core URL", (_name, transform) => {
		expect(images.url(SHARED_KEY, toSdk(transform))).toBe(imageUrl(SHARED_KEY, transform));
	});

	it.each(VALID_TRANSFORMS)("%s is routed to the same rewrite by core and the edge", (_name, transform) => {
		const path = pathOf(images.url(SHARED_KEY, toSdk(transform)));
		const rewrite = `/${SHARED_KEY}/_img/${path.slice("/img/".length).split("/")[0]}`;

		expect(routeImageUri(path)).toEqual({ kind: "rewrite", uri: rewrite });
		expect(edgeRewrite(path)).toBe(rewrite);
	});

	it.each(INVALID_TRANSFORMS)("%s is rejected with the core code", (_name, transform, code) => {
		const sdkTransform = toSdk(transform);

		expect(() => images.url(SHARED_KEY, sdkTransform)).toThrow(ValidationError);
		expect(errorCodeOf(() => images.url(SHARED_KEY, sdkTransform))).toBe(code);
		expect(errorCodeOf(() => imageUrl(SHARED_KEY, transform))).toBe(code);
	});

	it.each([
		["source key", "acme/sources/a1/original"],
		["upload key", "acme/uploads/u1/part"],
		["traversal", "acme/media/../sources/x"],
		["unsafe characters", "acme/media/ü.jpg"],
		["missing media segment", "acme/x/a1.jpg"]
	])("rejects a non-transformable key (%s) with the core code", (_name, key) => {
		expect(errorCodeOf(() => imageUrl(key, { w: 10 }))).toBe("invalid_key");
		expect(errorCodeOf(() => images.url(key, { w: 10 }))).toBe("invalid_key");
	});

	it("reports local image validation without a status", () => {
		const error = validationErrorOf(() => images.url(SHARED_KEY, { q: 80 }));

		expect(error.status).toBeUndefined();
	});

	it("appends the cache-buster as ?v=, matching core", () => {
		expect(images.url(SHARED_KEY, { w: 320 }, 7)).toBe(`${BASE}/img/w_320/${SHARED_KEY}?v=7`);
		expect(images.url(SHARED_KEY, { w: 320 }, 7)).toBe(imageUrl(SHARED_KEY, { w: 320 }, 7));
	});

	it("throws ConfigurationError when no image base URL was configured", () => {
		expect(() => new Images(undefined).url(SHARED_KEY, { w: 10 })).toThrow(ConfigurationError);
	});

	it("strips a trailing slash from the base URL", () => {
		expect(new Images(`${BASE}/`).url(SHARED_KEY, { w: 10 })).toBe(`${BASE}/img/w_10/${SHARED_KEY}`);
	});
});

function errorCodeOf(action: () => unknown): string | undefined {
	try {
		action();
	} catch (err) {
		return (err as { code?: string }).code;
	}
	return undefined;
}

function validationErrorOf(action: () => unknown): ValidationError {
	try {
		action();
	} catch (err) {
		expect(err).toBeInstanceOf(ValidationError);
		return err as ValidationError;
	}
	throw new Error("expected a ValidationError");
}
