import { CreateUploadRequestSchema, FileFromUrlRequestSchema } from "../src/api";

const base = { sizeBytes: 10, contentType: "video/mp4" };

describe("upload filenames", () => {
	it.each([".env", ".", "..", "..hidden", ".clip.mp4"])("rejects a filename starting with a dot: %s", (filename) => {
		expect(CreateUploadRequestSchema.safeParse({ ...base, filename }).success).toBe(false);
		expect(FileFromUrlRequestSchema.safeParse({ url: "https://example.test/a", filename }).success).toBe(false);
	});

	it("accepts a plain filename", () => {
		expect(CreateUploadRequestSchema.safeParse({ ...base, filename: "clip.mp4" }).success).toBe(true);
	});
});
