import sharp from "sharp";
import { parseImageParams } from "@helios/core";
import { renderVariant } from "../../src/image/render";
import { dimensionsOf, pixelAt, rgbaAt, solidPng, topBottomPng } from "../helpers/images";

const MAX_PIXELS = 50_000_000;

function render(source: Buffer, segment: string, maxPixels = MAX_PIXELS) {
	return renderVariant(source, parseImageParams(segment), maxPixels);
}

describe("renderVariant crop modes", () => {
	let wide: Buffer;

	beforeAll(async () => {
		wide = await solidPng(300, 200, [10, 20, 30]);
	});

	it("fit keeps aspect inside the box", async () => {
		const { body } = await render(wide, "w_100,h_100");
		expect(await dimensionsOf(body)).toEqual({ width: 100, height: 67 });
	});

	it("fit enlarges when asked", async () => {
		const { body } = await render(wide, "w_1000");
		expect(await dimensionsOf(body)).toEqual({ width: 1000, height: 667 });
	});

	it("fill covers the box exactly", async () => {
		const { body } = await render(wide, "w_100,h_100,c_fill");
		expect(await dimensionsOf(body)).toEqual({ width: 100, height: 100 });
	});

	it("limit never enlarges", async () => {
		const { body } = await render(wide, "w_1000,c_limit");
		expect(await dimensionsOf(body)).toEqual({ width: 300, height: 200 });
	});

	it("limit shrinks like fit", async () => {
		const { body } = await render(wide, "w_100,c_limit");
		expect(await dimensionsOf(body)).toEqual({ width: 100, height: 67 });
	});

	it("pad fills the box with the background colour", async () => {
		const { body, contentType } = await render(wide, "w_100,h_100,c_pad,b_ff0000,f_png");
		expect(contentType).toBe("image/png");
		expect(await dimensionsOf(body)).toEqual({ width: 100, height: 100 });
		expect(await pixelAt(body, 0, 0)).toEqual([255, 0, 0]);
		expect(await pixelAt(body, 50, 50)).toEqual([10, 20, 30]);
	});

	it("fill with north gravity keeps the top of the source", async () => {
		const tall = await topBottomPng(200, 400, [255, 0, 0], [0, 0, 255]);
		const { body } = await render(tall, "w_100,h_100,c_fill,g_north,f_png");
		expect(await pixelAt(body, 50, 50)).toEqual([255, 0, 0]);
	});

	it("fill with south gravity keeps the bottom of the source", async () => {
		const tall = await topBottomPng(200, 400, [255, 0, 0], [0, 0, 255]);
		const { body } = await render(tall, "w_100,h_100,c_fill,g_south,f_png");
		expect(await pixelAt(body, 50, 50)).toEqual([0, 0, 255]);
	});

	it("applies EXIF orientation before resizing", async () => {
		const rotated = await sharp(await solidPng(300, 200, [1, 2, 3]))
			.jpeg()
			.withMetadata({ orientation: 6 })
			.toBuffer();
		const { body } = await render(rotated, "w_100");
		expect(await dimensionsOf(body)).toEqual({ width: 100, height: 150 });
	});
});

describe("renderVariant formats and quality", () => {
	let png: Buffer;

	beforeAll(async () => {
		png = await solidPng(64, 64, [200, 100, 50]);
	});

	it.each([
		["f_jpg", "image/jpeg", "jpeg"],
		["f_png", "image/png", "png"],
		["f_webp", "image/webp", "webp"],
		["f_avif", "image/avif", "heif"]
	])("encodes %s as %s", async (segment, contentType, format) => {
		const { body, contentType: actual } = await render(png, `w_32,${segment}`);
		expect(actual).toBe(contentType);
		expect((await sharp(body).metadata()).format).toBe(format);
	});

	it("keeps the source format when f is omitted", async () => {
		const jpeg = await sharp(png).jpeg().toBuffer();
		expect((await render(jpeg, "w_32")).contentType).toBe("image/jpeg");
		expect((await render(png, "w_32")).contentType).toBe("image/png");
	});

	it("rejects a source format without an encoder when f is omitted", async () => {
		const tiff = await sharp(png).tiff().toBuffer();
		await expect(render(tiff, "w_32")).rejects.toMatchObject({ status: 415, code: "format_required" });
		expect((await render(tiff, "w_32,f_webp")).contentType).toBe("image/webp");
	});

	it("decodes an avif source by its heif container and keeps it as avif", async () => {
		const avif = await sharp(png).avif().toBuffer();
		expect((await render(avif, "w_32")).contentType).toBe("image/avif");
	});

	it("uses q to trade size for quality", async () => {
		const noisy = await topBottomPng(400, 400, [1, 200, 3], [250, 4, 99]);
		const low = await render(noisy, "w_400,f_jpg,q_10");
		const high = await render(noisy, "w_400,f_jpg,q_95");
		expect(low.body.length).toBeLessThan(high.body.length);
	});
});

describe("renderVariant alpha and padding", () => {
	let wide: Buffer;
	let transparent: Buffer;

	beforeAll(async () => {
		wide = await solidPng(300, 200, [10, 20, 30]);
		transparent = await sharp({
			create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
		})
			.png()
			.toBuffer();
	});

	it("flattens transparency onto white for jpg output", async () => {
		const { body } = await render(transparent, "w_32,f_jpg");
		expect((await pixelAt(body, 16, 16)).every((channel) => channel === 255)).toBe(true);
	});

	it("pads jpg output with white by default", async () => {
		const { body } = await render(wide, "w_100,h_100,c_pad,f_jpg");
		expect(await pixelAt(body, 0, 0)).toEqual([255, 255, 255]);
	});

	it("pads png output with transparency by default", async () => {
		const { body } = await render(wide, "w_100,h_100,c_pad,f_png");
		expect(await rgbaAt(body, 0, 0)).toEqual([0, 0, 0, 0]);
		expect(await rgbaAt(body, 50, 50)).toEqual([10, 20, 30, 255]);
	});

	it("pads jpg output with the b colour when given", async () => {
		const { body } = await render(wide, "w_100,h_100,c_pad,b_00ff00,f_jpg");
		const [red, green, blue] = await pixelAt(body, 0, 0);
		expect(red).toBeLessThan(10);
		expect(green).toBeGreaterThan(245);
		expect(blue).toBeLessThan(10);
	});
});

describe("renderVariant source formats", () => {
	it("rejects an svg source even with an explicit format", async () => {
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>'
		);
		await expect(render(svg, "w_4,f_png")).rejects.toMatchObject({ status: 415, code: "unsupported_source_format" });
	});
});

describe("renderVariant rejections", () => {
	it("rejects bytes that are not an image", async () => {
		await expect(render(Buffer.from("not an image"), "w_10")).rejects.toMatchObject({
			status: 415,
			code: "not_an_image"
		});
	});

	it("rejects sources over the pixel limit", async () => {
		const png = await solidPng(300, 200, [0, 0, 0]);
		await expect(render(png, "w_10", 1000)).rejects.toMatchObject({ status: 422, code: "too_many_pixels" });
	});
});
