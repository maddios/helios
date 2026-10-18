import { cdnUrl } from "../src/cdn";

const base = process.env.CDN_BASE_URL;

describe("cdnUrl", () => {
	it("builds the url from the key", () => {
		expect(cdnUrl("acme/media/a1/x.mp4")).toBe(`${base}/acme/media/a1/x.mp4`);
	});

	it("appends the version when given", () => {
		expect(cdnUrl("acme/media/a1/x.mp4", 3)).toBe(`${base}/acme/media/a1/x.mp4?v=3`);
	});
});
