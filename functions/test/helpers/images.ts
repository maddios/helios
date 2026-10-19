import { randomFillSync } from "node:crypto";
import sharp from "sharp";

export type Rgb = [number, number, number];

export function solidPng(width: number, height: number, [r, g, b]: Rgb): Promise<Buffer> {
	return sharp({ create: { width, height, channels: 3, background: { r, g, b } } })
		.png()
		.toBuffer();
}

export function topBottomPng(width: number, height: number, top: Rgb, bottom: Rgb): Promise<Buffer> {
	const half = height / 2;
	const raw = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y++) {
		const color = y < half ? top : bottom;
		for (let x = 0; x < width; x++) {
			raw.set(color, (y * width + x) * 3);
		}
	}
	return sharp(raw, { raw: { width, height, channels: 3 } })
		.png()
		.toBuffer();
}

export function noisePng(width: number, height: number): Promise<Buffer> {
	const raw = Buffer.alloc(width * height * 3);
	randomFillSync(raw);
	return sharp(raw, { raw: { width, height, channels: 3 } })
		.png({ compressionLevel: 0 })
		.toBuffer();
}

export async function pixelAt(image: Buffer, x: number, y: number): Promise<number[]> {
	const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
	const offset = (y * info.width + x) * info.channels;
	return Array.from(data.subarray(offset, offset + 3));
}

export async function rgbaAt(image: Buffer, x: number, y: number): Promise<number[]> {
	const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	const offset = (y * info.width + x) * info.channels;
	return Array.from(data.subarray(offset, offset + 4));
}

export async function dimensionsOf(image: Buffer): Promise<{ width: number; height: number }> {
	const { width = 0, height = 0 } = await sharp(image).metadata();
	return { width, height };
}
