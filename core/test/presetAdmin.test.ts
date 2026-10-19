import { randomUUID } from "node:crypto";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
	type ProfileInput,
	type SourceMetadata
} from "@helios/contracts";
import { encodingPresets, ensureIndexes } from "../src/models";
import { genericPreset } from "../src/presets";
import {
	addProfile,
	clonePreset,
	createPreset,
	deletePreset,
	dryRunPreset,
	listPresets,
	listSystemPresets,
	removeProfile,
	resolvePreset,
	seedSystemPreset,
	updatePreset,
	updateProfile
} from "../src/presetAdmin";
import { resetDb, startMongo, stopMongo } from "./helpers/mongo";

const ACCOUNT = "acc-1";
const OTHER_ACCOUNT = "acc-2";

const createInput = {
	name: "my-preset",
	description: "My preset",
	profiles: genericPreset.profiles,
	postProcess: genericPreset.postProcess
};

const newProfile: ProfileInput = {
	name: "mp4_240",
	type: "video",
	priority: 1,
	isDefault: false,
	sourceTypes: ["video"],
	children: [],
	output: "{id}_240.mp4",
	params: {
		codec: "h264",
		height: 240,
		videoBitrateK: 300,
		audioBitrateK: 64,
		audioSampleRate: 44100,
		rateControl: "vbr",
		x264Preset: "veryfast",
		x264Profile: "main",
		x264Opts: "",
		deinterlace: false,
		fps: 30,
		gopSeconds: 2,
		faststart: true
	}
};

async function insertSystemGeneric(): Promise<void> {
	const now = new Date();
	await encodingPresets().insertOne({
		...genericPreset,
		_id: randomUUID(),
		accountId: null,
		createdAt: now,
		updatedAt: now
	});
}

async function storedPreset(name: string, accountId: string | null) {
	return encodingPresets().findOne({ name, accountId });
}

async function createMyPreset() {
	const created = await createPreset(ACCOUNT, createInput);
	expect(created.version).toBe(1);
	return created;
}

describe("presetAdmin", () => {
	beforeAll(startMongo);
	afterAll(stopMongo);

	beforeEach(async () => {
		await resetDb();
		await ensureIndexes();
	});

	describe("create", () => {
		it("creates a version 1 account preset whose profiles are version 1", async () => {
			const preset = await createPreset(ACCOUNT, createInput);
			expect(preset.version).toBe(1);
			expect(preset.accountId).toBe(ACCOUNT);
			expect(preset.profiles.every((profile) => profile.version === 1)).toBe(true);
		});

		it("rejects a duplicate name with a conflict", async () => {
			await createPreset(ACCOUNT, createInput);
			await expect(createPreset(ACCOUNT, createInput)).rejects.toBeInstanceOf(ConflictError);
		});

		it("rejects an invalid profile and stores nothing", async () => {
			const profiles = genericPreset.profiles.map((profile) =>
				profile.name === "mp4_360" ? { ...profile, children: ["missing"] } : profile
			);
			await expect(createPreset(ACCOUNT, { ...createInput, profiles })).rejects.toBeInstanceOf(ValidationError);
			expect(await storedPreset("my-preset", ACCOUNT)).toBeNull();
		});
	});

	describe("updatePreset", () => {
		it("bumps the version and applies the description", async () => {
			const created = await createMyPreset();
			const updated = await updatePreset(ACCOUNT, "my-preset", { expectedVersion: 1, description: "Changed" });
			expect(updated.version).toBe(2);
			expect(updated.description).toBe("Changed");
			expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
			expect((await storedPreset("my-preset", ACCOUNT))?.version).toBe(2);
		});

		it("rejects a stale expectedVersion with 409 and leaves the stored preset unchanged", async () => {
			await createMyPreset();
			await updatePreset(ACCOUNT, "my-preset", { expectedVersion: 1, description: "First" });
			const before = await storedPreset("my-preset", ACCOUNT);

			await expect(
				updatePreset(ACCOUNT, "my-preset", { expectedVersion: 1, description: "Stale" })
			).rejects.toMatchObject({
				code: "preset_version_conflict",
				httpStatus: 409
			});
			expect(await storedPreset("my-preset", ACCOUNT)).toEqual(before);
		});
	});

	describe("updateProfile", () => {
		it("merges params and bumps the profile and preset versions", async () => {
			await createMyPreset();
			const updated = await updateProfile(ACCOUNT, "my-preset", "mp4_360", {
				expectedVersion: 1,
				params: { height: 720 }
			});
			const profile = updated.profiles.find((candidate) => candidate.name === "mp4_360");
			expect(updated.version).toBe(2);
			expect(profile?.version).toBe(2);
			expect(profile?.type === "video" && profile.params.height).toBe(720);
			expect(profile?.type === "video" && profile.params.videoBitrateK).toBe(800);
			const others = updated.profiles.filter((candidate) => candidate.name !== "mp4_360");
			expect(others).toEqual(genericPreset.profiles.filter((candidate) => candidate.name !== "mp4_360"));
		});

		it("rejects an invalid param and leaves the stored preset unchanged", async () => {
			await createMyPreset();
			const before = await storedPreset("my-preset", ACCOUNT);
			await expect(
				updateProfile(ACCOUNT, "my-preset", "mp4_360", { expectedVersion: 1, params: { height: 0 } })
			).rejects.toBeInstanceOf(ValidationError);
			expect(await storedPreset("my-preset", ACCOUNT)).toEqual(before);
		});

		it("rejects an unknown profile", async () => {
			await createMyPreset();
			await expect(updateProfile(ACCOUNT, "my-preset", "nope", { expectedVersion: 1 })).rejects.toBeInstanceOf(
				NotFoundError
			);
		});

		it("rejects a stale expectedVersion with 409", async () => {
			await createMyPreset();
			await updatePreset(ACCOUNT, "my-preset", { expectedVersion: 1, description: "Bumped" });

			await expect(
				updateProfile(ACCOUNT, "my-preset", "mp4_360", { expectedVersion: 1, priority: 9 })
			).rejects.toMatchObject({ code: "preset_version_conflict", httpStatus: 409 });
		});
	});

	describe("addProfile", () => {
		it("adds a version 1 profile and bumps the preset version", async () => {
			await createMyPreset();
			const updated = await addProfile(ACCOUNT, "my-preset", { expectedVersion: 1, profile: newProfile });
			expect(updated.version).toBe(2);
			expect(updated.profiles.find((profile) => profile.name === "mp4_240")?.version).toBe(1);
			expect(updated.profiles).toHaveLength(genericPreset.profiles.length + 1);
		});

		it("rejects a duplicate profile name with a validation error and stores nothing", async () => {
			await createMyPreset();
			const before = await storedPreset("my-preset", ACCOUNT);
			await expect(
				addProfile(ACCOUNT, "my-preset", { expectedVersion: 1, profile: { ...newProfile, name: "audio" } })
			).rejects.toBeInstanceOf(ValidationError);
			expect(await storedPreset("my-preset", ACCOUNT)).toEqual(before);
		});

		it("rejects a stale expectedVersion with 409", async () => {
			await createMyPreset();
			await expect(addProfile(ACCOUNT, "my-preset", { expectedVersion: 2, profile: newProfile })).rejects.toMatchObject(
				{ code: "preset_version_conflict", httpStatus: 409 }
			);
		});
	});

	describe("removeProfile", () => {
		it("removes a non-default, unreferenced profile and bumps the preset version", async () => {
			await createMyPreset();
			const updated = await removeProfile(ACCOUNT, "my-preset", "mp4_720", { expectedVersion: 1 });
			expect(updated.version).toBe(2);
			expect(updated.profiles.map((profile) => profile.name)).not.toContain("mp4_720");
		});

		it("refuses to remove the default profile", async () => {
			await createMyPreset();
			await expect(removeProfile(ACCOUNT, "my-preset", "mp4_360", { expectedVersion: 1 })).rejects.toBeInstanceOf(
				ValidationError
			);
		});

		it("refuses to remove a child profile that another profile references", async () => {
			await createMyPreset();
			await expect(removeProfile(ACCOUNT, "my-preset", "stills", { expectedVersion: 1 })).rejects.toBeInstanceOf(
				ValidationError
			);
			expect(await storedPreset("my-preset", ACCOUNT)).toMatchObject({ version: 1 });
		});

		it("rejects an unknown profile", async () => {
			await createMyPreset();
			await expect(removeProfile(ACCOUNT, "my-preset", "nope", { expectedVersion: 1 })).rejects.toBeInstanceOf(
				NotFoundError
			);
		});

		it("rejects a stale expectedVersion with 409", async () => {
			await createMyPreset();
			await expect(removeProfile(ACCOUNT, "my-preset", "mp4_720", { expectedVersion: 7 })).rejects.toMatchObject({
				code: "preset_version_conflict",
				httpStatus: 409
			});
		});
	});

	describe("deletePreset", () => {
		it("deletes at the expected version", async () => {
			await createMyPreset();
			await deletePreset(ACCOUNT, "my-preset", { expectedVersion: 1 });
			expect(await storedPreset("my-preset", ACCOUNT)).toBeNull();
		});

		it("rejects a stale expectedVersion with 409 and keeps the preset", async () => {
			await createMyPreset();
			await expect(deletePreset(ACCOUNT, "my-preset", { expectedVersion: 2 })).rejects.toMatchObject({
				code: "preset_version_conflict",
				httpStatus: 409
			});
			expect(await storedPreset("my-preset", ACCOUNT)).not.toBeNull();
		});
	});

	describe("shadowing", () => {
		it("lets an account preset hide the system preset of the same name", async () => {
			await insertSystemGeneric();
			await clonePreset(ACCOUNT, "generic", "generic");
			const resolved = await resolvePreset(ACCOUNT, "generic");
			expect(resolved.accountId).toBe(ACCOUNT);
			expect((await listPresets(ACCOUNT)).filter((preset) => preset.name === "generic")).toHaveLength(1);
		});

		it("reveals the system preset once the account preset is deleted", async () => {
			await insertSystemGeneric();
			await clonePreset(ACCOUNT, "generic", "generic");
			const cloned = await resolvePreset(ACCOUNT, "generic");
			await deletePreset(ACCOUNT, "generic", { expectedVersion: cloned.version });
			expect((await resolvePreset(ACCOUNT, "generic")).accountId).toBeNull();
		});

		it("throws NotFound for a preset that exists nowhere", async () => {
			await expect(resolvePreset(ACCOUNT, "missing")).rejects.toBeInstanceOf(NotFoundError);
		});
	});

	describe("system immutability", () => {
		beforeEach(insertSystemGeneric);

		it("forbids updating the system preset through an account", async () => {
			await expect(
				updatePreset(ACCOUNT, "generic", { expectedVersion: genericPreset.version, description: "x" })
			).rejects.toBeInstanceOf(ForbiddenError);
		});

		it("forbids updating a profile of the system preset through an account", async () => {
			await expect(
				updateProfile(ACCOUNT, "generic", "mp4_360", { expectedVersion: genericPreset.version })
			).rejects.toBeInstanceOf(ForbiddenError);
		});

		it("forbids adding or removing profiles of the system preset through an account", async () => {
			await expect(
				addProfile(ACCOUNT, "generic", { expectedVersion: genericPreset.version, profile: newProfile })
			).rejects.toBeInstanceOf(ForbiddenError);
			await expect(
				removeProfile(ACCOUNT, "generic", "mp4_720", { expectedVersion: genericPreset.version })
			).rejects.toBeInstanceOf(ForbiddenError);
		});

		it("forbids deleting the system preset through an account", async () => {
			await expect(deletePreset(ACCOUNT, "generic", { expectedVersion: genericPreset.version })).rejects.toBeInstanceOf(
				ForbiddenError
			);
		});

		it("lets the system owner update the system preset", async () => {
			const updated = await updatePreset(null, "generic", {
				expectedVersion: genericPreset.version,
				description: "Updated system"
			});
			expect(updated.version).toBe(genericPreset.version + 1);
			expect(updated.accountId).toBeNull();
		});

		it("lists system presets for other accounts", async () => {
			expect((await listPresets(OTHER_ACCOUNT)).map((preset) => preset.name)).toEqual(["generic"]);
			expect((await listSystemPresets()).map((preset) => preset.name)).toEqual(["generic"]);
		});
	});

	describe("clonePreset", () => {
		beforeEach(insertSystemGeneric);

		it("clones a system preset as a version 1 account preset keeping profiles", async () => {
			const cloned = await clonePreset(ACCOUNT, "generic", "my-generic");
			expect(cloned.version).toBe(1);
			expect(cloned.accountId).toBe(ACCOUNT);
			expect(cloned.profiles).toEqual(genericPreset.profiles);
		});

		it("clones from an own preset", async () => {
			await clonePreset(ACCOUNT, "generic", "my-generic");
			const again = await clonePreset(ACCOUNT, "my-generic", "my-generic-2");
			expect(again.profiles).toEqual(genericPreset.profiles);
		});

		it("rejects a duplicate clone with a conflict", async () => {
			await clonePreset(ACCOUNT, "generic", "my-generic");
			await expect(clonePreset(ACCOUNT, "generic", "my-generic")).rejects.toBeInstanceOf(ConflictError);
		});
	});

	describe("dryRunPreset", () => {
		it("plans encode and transcribe items for a 1080p source with audio", () => {
			const items = dryRunPreset({
				preset: genericPreset,
				sourceMetadata: {
					type: "video",
					width: 1920,
					height: 1080,
					durationSec: 20,
					fps: 30,
					videoCodec: "h264",
					hasAudio: true,
					sizeBytes: 1000000
				} satisfies SourceMetadata,
				postProcess: { transcribe: { translations: [], english: true, retranscribe: false }, sceneDetection: false },
				mode: "encode"
			});
			expect(items).toContainEqual(expect.objectContaining({ key: "mp4_360", kind: "encode" }));
			expect(items.some((item) => item.kind === "transcribe")).toBe(true);
		});
	});

	describe("seedSystemPreset", () => {
		it("inserts, then leaves an equal version unchanged, then replaces on a higher version", async () => {
			expect(await seedSystemPreset(genericPreset)).toBe("inserted");
			expect(await seedSystemPreset(genericPreset)).toBe("unchanged");
			expect(await seedSystemPreset({ ...genericPreset, version: 2 })).toBe("replaced");
			expect((await storedPreset("generic", null))?.version).toBe(2);
		});
	});
});
