import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StillsProfile } from "@helios/contracts";
import { mediaAssets, objectStore } from "@helios/core";
import { storeOutputs } from "../../src/handlers/storage";
import { SupersededError } from "../../src/handlers/supersession";
import type { HandlerContext } from "../../src/handlers/types";

jest.mock("@helios/core", () => ({
	...jest.requireActual("@helios/core"),
	objectStore: jest.fn(),
	mediaAssets: jest.fn()
}));

const PREFIX = "acme/media/asset-1/";
const stills: StillsProfile = {
	name: "stills",
	version: 1,
	type: "stills",
	output: "tmb/%04d.jpg",
	params: { fps: "1/3" }
} as unknown as StillsProfile;

describe("storeOutputs stills", () => {
	let dir: string;
	let calls: string[];
	let store: { uploadFile: jest.Mock; listKeys: jest.Mock; deleteKeys: jest.Mock };
	let versions: number[];

	beforeEach(async () => {
		dir = await mkdtemp(path.join(os.tmpdir(), "storage-stills-"));
		await writeFile(path.join(dir, "0001.jpg"), "a");
		await writeFile(path.join(dir, "0002.jpg"), "b");
		calls = [];
		versions = [2, 2];
		store = {
			uploadFile: jest.fn(async (key: string) => {
				calls.push(`upload ${key}`);
				return 1;
			}),
			listKeys: jest.fn(),
			deleteKeys: jest.fn(async () => {
				calls.push("delete");
			})
		};
		jest.mocked(objectStore).mockReturnValue(store as never);
		jest.mocked(mediaAssets).mockReturnValue({
			findOne: jest.fn(async () => {
				calls.push("check");
				return { version: versions.shift() ?? 2 };
			})
		} as never);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	function ctx(): HandlerContext {
		return {
			asset: { _id: "asset-1", accountId: "acc-1" },
			request: { assetVersion: 2 },
			account: { slug: "acme" }
		} as unknown as HandlerContext;
	}

	it("checks the version, uploads the stills, checks again, then deletes only the stale stills", async () => {
		store.listKeys.mockResolvedValue([`${PREFIX}tmb/0001.jpg`, `${PREFIX}tmb/0002.jpg`, `${PREFIX}tmb/0009.jpg`]);

		await storeOutputs(ctx(), [{ profile: stills, localPath: path.join(dir, "0001.jpg") }]);

		expect(calls).toEqual(["check", `upload ${PREFIX}tmb/0001.jpg`, `upload ${PREFIX}tmb/0002.jpg`, "check", "delete"]);
		expect(store.listKeys).toHaveBeenCalledWith(`${PREFIX}tmb/`);
		expect(store.deleteKeys).toHaveBeenCalledWith([`${PREFIX}tmb/0009.jpg`]);
	});

	it("deletes nothing when every existing still was overwritten", async () => {
		store.listKeys.mockResolvedValue([`${PREFIX}tmb/0001.jpg`, `${PREFIX}tmb/0002.jpg`]);

		await storeOutputs(ctx(), [{ profile: stills, localPath: path.join(dir, "0001.jpg") }]);

		expect(store.deleteKeys).not.toHaveBeenCalled();
	});

	it("deletes nothing and throws SupersededError when the asset moved on between upload and delete", async () => {
		versions = [2, 3];
		store.listKeys.mockResolvedValue([`${PREFIX}tmb/0009.jpg`]);

		await expect(storeOutputs(ctx(), [{ profile: stills, localPath: path.join(dir, "0001.jpg") }])).rejects.toThrow(
			SupersededError
		);

		expect(store.deleteKeys).not.toHaveBeenCalled();
	});
});
