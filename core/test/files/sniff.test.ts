import { sniffHead } from "../../src/files/sniff";

function pngHeader(width: number, height: number): Buffer {
	const ihdr = Buffer.alloc(25);
	ihdr.writeUInt32BE(13, 0);
	ihdr.write("IHDR", 4);
	ihdr.writeUInt32BE(width, 8);
	ihdr.writeUInt32BE(height, 12);
	ihdr[16] = 8;
	ihdr[17] = 6;
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
}

const JPEG_16X8 = Buffer.from(
	"/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCKALXj/9k=",
	"base64"
);

describe("sniffHead", () => {
	it("detects a png from its signature and reads its dimensions", () => {
		expect(sniffHead(pngHeader(640, 360))).toMatchObject({
			contentType: "image/png",
			image: { width: 640, height: 360, format: "png" }
		});
	});

	it("detects a jpeg and reads its dimensions", () => {
		expect(sniffHead(JPEG_16X8)).toMatchObject({
			contentType: "image/jpeg",
			image: { width: 16, height: 8, format: "jpeg" }
		});
	});

	it("reports plain text as text/plain, so a .png that holds text is not an image", () => {
		expect(sniffHead(Buffer.from("this is not a png\n"))).toMatchObject({ contentType: "text/plain" });
	});

	it("reports bytes that are neither text nor a known format as octet-stream", () => {
		expect(sniffHead(Buffer.from([0x00, 0x01, 0x02, 0xff]))).toMatchObject({ contentType: "application/octet-stream" });
	});
});
