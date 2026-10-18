import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { convertImage } from "../src/image/convert";

describe("convertImage", () => {
	let dir: string;

	beforeAll(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "helios-convert-"));
	});

	afterAll(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("applies the EXIF orientation so the output dimensions are swapped", async () => {
		const input = path.join(dir, "rotated.jpg");
		await sharp({ create: { width: 40, height: 20, channels: 3, background: "#808080" } })
			.jpeg()
			.withMetadata({ orientation: 6 })
			.toFile(input);
		const out = path.join(dir, "out.jpg");

		await convertImage(input, out, { format: "jpg", quality: 80 });

		expect(await sharp(out).metadata()).toMatchObject({ width: 20, height: 40 });
	});
});
