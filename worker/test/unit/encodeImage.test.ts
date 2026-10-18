import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EncodingProfile, StillsProfile } from "@helios/contracts";
import { objectStore } from "@helios/core";
import { convertImage } from "../../src/image/convert";
import { encodeImage } from "../../src/handlers/image/encodeImage";
import { storeOutputs } from "../../src/handlers/storage";
import type { HandlerContext } from "../../src/handlers/types";

jest.mock("@helios/core", () => ({ ...jest.requireActual("@helios/core"), objectStore: jest.fn() }));
jest.mock("../../src/image/convert", () => ({ convertImage: jest.fn() }));
jest.mock("../../src/handlers/storage", () => ({ storeOutputs: jest.fn() }));

const SOURCE_URL = "https://example.test/source";
const image: EncodingProfile = {
	name: "image",
	version: 1,
	type: "image",
	output: "{id}.jpg",
	params: { format: "jpg", quality: 80 },
	children: ["image_still"]
} as unknown as EncodingProfile;
const still: StillsProfile = {
	name: "image_still",
	version: 1,
	type: "stills",
	output: "{id}-stills/%04d.jpg",
	params: { fps: "1/1", maxCount: 1 }
} as unknown as StillsProfile;

describe("encodeImage", () => {
	let workDir: string;

	beforeEach(async () => {
		workDir = await mkdtemp(path.join(os.tmpdir(), "encode-image-"));
		jest.mocked(objectStore).mockReturnValue({ presignGet: jest.fn().mockResolvedValue(SOURCE_URL) } as never);
		jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("source-bytes"));
		jest.mocked(storeOutputs).mockResolvedValue({ assetOutputs: {}, outputBytes: 0 });
	});

	afterEach(async () => {
		jest.restoreAllMocks();
		await rm(workDir, { recursive: true, force: true });
	});

	it("writes the primary and child outputs with {id} substituted in both paths", async () => {
		const ctx = {
			asset: { _id: "asset-1", source: { bucket: "src", key: "source.jpg" } },
			workDir,
			signal: new AbortController().signal
		} as unknown as HandlerContext;

		await encodeImage(ctx, image, [still]);

		expect(convertImage).toHaveBeenNthCalledWith(1, path.join(workDir, "source"), path.join(workDir, "asset-1.jpg"), {
			format: "jpg",
			quality: 80
		});
		expect(convertImage).toHaveBeenNthCalledWith(
			2,
			path.join(workDir, "source"),
			path.join(workDir, "asset-1-stills", "0001.jpg"),
			{
				format: "jpg",
				quality: 80
			}
		);
		expect(storeOutputs).toHaveBeenCalledWith(
			ctx,
			expect.arrayContaining([
				expect.objectContaining({ profile: still, localPath: path.join(workDir, "asset-1-stills", "0001.jpg") })
			])
		);
	});
});
