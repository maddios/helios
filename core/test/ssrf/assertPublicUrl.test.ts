import { resetConfigForTests } from "../../src/config";
import { assertPublicUrl, UnsafeUrlError, type ResolvedAddress } from "../../src/ssrf";

describe("assertPublicUrl", () => {
	const original = process.env;
	const resolve = jest.fn<Promise<ResolvedAddress[]>, [string]>();

	beforeEach(() => {
		process.env = { ...original, SSRF_ALLOWED_HOSTS: "allowed.test" };
		resetConfigForTests();
		resolve.mockReset();
	});

	afterEach(() => {
		process.env = original;
		resetConfigForTests();
	});

	it("rejects schemes other than http and https", async () => {
		await expect(assertPublicUrl("ftp://example.com/file", { resolve })).rejects.toBeInstanceOf(UnsafeUrlError);
		await expect(assertPublicUrl("file:///etc/passwd", { resolve })).rejects.toBeInstanceOf(UnsafeUrlError);
		expect(resolve).not.toHaveBeenCalled();
	});

	it("rejects literal private addresses without a DNS lookup", async () => {
		await expect(assertPublicUrl("http://10.0.0.1/", { resolve })).rejects.toThrow(
			"URL host resolves to a private address"
		);
		await expect(assertPublicUrl("http://[::1]/", { resolve })).rejects.toBeInstanceOf(UnsafeUrlError);
		expect(resolve).not.toHaveBeenCalled();
	});

	it("rejects a host that resolves to one private address among public ones", async () => {
		resolve.mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
			{ address: "169.254.169.254", family: 4 }
		]);
		await expect(assertPublicUrl("https://mixed.example/path", { resolve })).rejects.toBeInstanceOf(UnsafeUrlError);
	});

	it("returns the first address of a host that resolves only to public addresses", async () => {
		resolve.mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
			{ address: "2606:2800:220:1::1", family: 6 }
		]);
		const result = await assertPublicUrl("https://example.com/a?b=c", { resolve });
		expect(result.address).toBe("93.184.216.34");
		expect(result.family).toBe(4);
		expect(result.url.href).toBe("https://example.com/a?b=c");
	});

	it("accepts an allowlisted host even when it resolves to a private address, and pins it", async () => {
		resolve.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
		const result = await assertPublicUrl("http://ALLOWED.test:8080/", { resolve });
		expect(result).toMatchObject({ address: "127.0.0.1", family: 4 });
		expect(resolve).toHaveBeenCalledWith("allowed.test");
	});

	it("rejects ports other than 80 and 443 outside the local stage", async () => {
		process.env = { ...original, STAGE: "prod", SSRF_ALLOWED_HOSTS: "" };
		resetConfigForTests();
		resolve.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		await expect(assertPublicUrl("https://example.com:8443/", { resolve })).rejects.toThrow(
			"URL port must be 80 or 443"
		);
		await expect(assertPublicUrl("https://example.com:443/", { resolve })).resolves.toMatchObject({
			address: "93.184.216.34"
		});
		await expect(assertPublicUrl("http://example.com:80/", { resolve })).resolves.toMatchObject({ family: 4 });
	});

	it("allows any port in the local stage", async () => {
		resolve.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		await expect(assertPublicUrl("https://example.com:8443/", { resolve })).resolves.toMatchObject({ family: 4 });
	});

	it("rejects a host that does not resolve", async () => {
		resolve.mockRejectedValue(new UnsafeUrlError("URL host could not be resolved"));
		await expect(assertPublicUrl("https://missing.example/", { resolve })).rejects.toMatchObject({
			code: "unsafe_url",
			httpStatus: 400
		});
	});

	it("rejects an unparseable URL", async () => {
		await expect(assertPublicUrl("not a url", { resolve })).rejects.toBeInstanceOf(UnsafeUrlError);
		expect(resolve).not.toHaveBeenCalled();
	});
});
