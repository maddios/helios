import sharp from "sharp";

export type ImageFormat = "jpg" | "png" | "webp";

const encoders: Record<ImageFormat, (pipeline: sharp.Sharp, quality: number) => sharp.Sharp> = {
	jpg: (pipeline, quality) => pipeline.jpeg({ quality }),
	png: (pipeline) => pipeline.png(),
	webp: (pipeline, quality) => pipeline.webp({ quality })
};

export async function convertImage(
	inputPath: string,
	outPath: string,
	{ format, quality }: { format: ImageFormat; quality: number }
): Promise<void> {
	await encoders[format](sharp(inputPath).rotate(), quality).toFile(outPath);
}
