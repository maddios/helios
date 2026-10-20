import {
	AddProfileRequestSchema,
	CreatePresetRequestSchema,
	DryRunRequestSchema,
	ExpectedVersionQuerySchema,
	ProfilePatchSchema,
	UpdateProfileRequestSchema
} from "../src/api/presets";
import { EncodeRequestSchema, EncodeSourceSchema, PlannedItemSchema } from "../src/api/encode";
import { UpdateAccountRequestSchema } from "../src/api/adminAccounts";
import { CompleteUploadRequestSchema, CreateUploadRequestSchema } from "../src/api/uploads";
import { UploadPolicySchema } from "../src/api/uploadPolicy";

describe("EncodeSourceSchema", () => {
	it("accepts each source shape", () => {
		expect(EncodeSourceSchema.safeParse({ bucket: "b", key: "k.mp4" }).success).toBe(true);
		expect(EncodeSourceSchema.safeParse({ fileId: "0b1c2d3e-0000-4000-8000-000000000001" }).success).toBe(true);
		expect(EncodeSourceSchema.safeParse({ url: "https://example.com/a.mp4" }).success).toBe(true);
	});

	it("rejects mixed source shapes", () => {
		expect(EncodeSourceSchema.safeParse({ bucket: "b", key: "k.mp4", url: "https://example.com/a.mp4" }).success).toBe(
			false
		);
	});
});

describe("EncodeRequestSchema", () => {
	it("defaults analyze to async", () => {
		const parsed = EncodeRequestSchema.parse({
			source: { fileId: "0b1c2d3e-0000-4000-8000-000000000001" },
			preset: "std"
		});
		expect(parsed.analyze).toBe("async");
	});
});

describe("DryRunRequestSchema", () => {
	it("rejects neither assetId nor sourceMetadata", () => {
		expect(DryRunRequestSchema.safeParse({}).success).toBe(false);
	});

	it("rejects both assetId and sourceMetadata", () => {
		const sourceMetadata = { type: "image", sizeBytes: 10, width: 1, height: 1, hasAudio: false };
		expect(DryRunRequestSchema.safeParse({ assetId: "a1", sourceMetadata }).success).toBe(false);
	});

	it("accepts exactly one of assetId", () => {
		expect(DryRunRequestSchema.safeParse({ assetId: "a1" }).success).toBe(true);
	});
});

describe("ProfilePatchSchema", () => {
	it("accepts a partial patch", () => {
		expect(ProfilePatchSchema.safeParse({ priority: 5 }).success).toBe(true);
	});
});

describe("CreatePresetRequestSchema", () => {
	it("omits version from the request shape", () => {
		expect(CreatePresetRequestSchema.shape).not.toHaveProperty("version");
	});
});

describe("preset API schemas", () => {
	const profile = {
		name: "mp4_360",
		type: "video",
		priority: 1,
		isDefault: true,
		sourceTypes: ["video"],
		children: [],
		output: "{id}.mp4",
		params: {
			codec: "h264",
			height: 360,
			videoBitrateK: 800,
			audioBitrateK: 128,
			audioSampleRate: 44100,
			rateControl: "vbr",
			x264Preset: "medium",
			x264Profile: "main",
			x264Opts: "",
			deinterlace: false,
			fps: 30,
			gopSeconds: 2,
			faststart: true
		}
	};
	const postProcess = { transcribe: false, sceneDetection: false };

	it("creates a preset whose profiles need no version", () => {
		const result = CreatePresetRequestSchema.safeParse({
			name: "my-preset",
			description: "Mine",
			profiles: [profile],
			postProcess
		});
		expect(result.success).toBe(true);
	});

	it.each(["a", "Bad_Name", "-lead", "has space", "x".repeat(64)])("rejects preset name %s", (name) => {
		expect(
			CreatePresetRequestSchema.safeParse({ name, description: "", profiles: [profile], postProcess }).success
		).toBe(false);
	});

	it("requires expectedVersion on profile add", () => {
		expect(AddProfileRequestSchema.safeParse({ profile }).success).toBe(false);
		expect(AddProfileRequestSchema.safeParse({ expectedVersion: 1, profile }).success).toBe(true);
	});

	it("requires expectedVersion on profile patch and accepts a partial patch", () => {
		expect(UpdateProfileRequestSchema.safeParse({ priority: 5 }).success).toBe(false);
		expect(UpdateProfileRequestSchema.safeParse({ expectedVersion: 1, priority: 5 }).success).toBe(true);
	});

	it("coerces the expectedVersion query parameter", () => {
		expect(ExpectedVersionQuerySchema.parse({ expectedVersion: "3" })).toEqual({ expectedVersion: 3 });
		expect(ExpectedVersionQuerySchema.safeParse({}).success).toBe(false);
	});

	it("rejects purge as a dry run mode", () => {
		expect(DryRunRequestSchema.safeParse({ assetId: "a1", mode: "purge" }).success).toBe(false);
		expect(DryRunRequestSchema.safeParse({ assetId: "a1", mode: "reencode" }).success).toBe(true);
	});
});

describe("PlannedItemSchema", () => {
	it("rejects the analyze queue for pipeline items", () => {
		const item = { key: "k", kind: "encode", queue: "analyze", priority: 1, status: "QUEUED", dependsOn: [] };
		expect(PlannedItemSchema.safeParse(item).success).toBe(false);
		expect(PlannedItemSchema.safeParse({ ...item, queue: "fargate-p1" }).success).toBe(true);
	});
});

describe("callback URLs", () => {
	it.each(["ftp://example.com/hook", "file:///etc/passwd", "not a url"])("rejects %s", (callbackUrl) => {
		expect(
			EncodeRequestSchema.safeParse({
				source: { fileId: "0b1c2d3e-0000-4000-8000-000000000001" },
				preset: "generic",
				callbackUrl
			}).success
		).toBe(false);
	});

	it("accepts http and https", () => {
		for (const callbackUrl of ["http://example.com/hook", "https://example.com/hook"]) {
			expect(
				EncodeRequestSchema.safeParse({
					source: { fileId: "0b1c2d3e-0000-4000-8000-000000000001" },
					preset: "generic",
					callbackUrl
				}).success
			).toBe(true);
		}
	});

	it("accepts a destination or callbackUrl on an account update", () => {
		expect(UpdateAccountRequestSchema.safeParse({ name: "a" }).success).toBe(true);
		expect(UpdateAccountRequestSchema.safeParse({ callbackUrl: "ftp://example.com" }).success).toBe(false);
		expect(
			UpdateAccountRequestSchema.safeParse({ destination: { type: "eventbridge", eventBusArn: "bad" } }).success
		).toBe(false);
	});
});

describe("CreateUploadRequestSchema", () => {
	it("requires sizeBytes and a type/subtype content type", () => {
		expect(CreateUploadRequestSchema.safeParse({ filename: "clip.mp4", contentType: "video/mp4" }).success).toBe(false);
		expect(
			CreateUploadRequestSchema.safeParse({ filename: "clip.mp4", sizeBytes: 10, contentType: "video" }).success
		).toBe(false);
		expect(
			CreateUploadRequestSchema.safeParse({ filename: "clip.mp4", sizeBytes: 10, contentType: "Video/MP4" }).data
		).toMatchObject({ contentType: "video/mp4" });
	});
});

describe("CompleteUploadRequestSchema", () => {
	const fileId = "0b1c2d3e-0000-4000-8000-000000000001";

	it("accepts store or encode, and rejects both", () => {
		expect(CompleteUploadRequestSchema.safeParse({ store: true }).success).toBe(true);
		expect(CompleteUploadRequestSchema.safeParse({ encode: { preset: "generic" } }).success).toBe(true);
		expect(CompleteUploadRequestSchema.safeParse({ store: true, encode: { preset: "generic" } }).success).toBe(false);
		expect(CompleteUploadRequestSchema.safeParse({}).success).toBe(false);
		expect(fileId).toHaveLength(36);
	});

	it("accepts parts alongside the target", () => {
		expect(CompleteUploadRequestSchema.safeParse({ store: true, parts: [{ partNumber: 1, etag: "e" }] }).success).toBe(
			true
		);
	});
});

describe("UploadPolicySchema", () => {
	it("accepts exact types, type wildcards and */*, and rejects malformed patterns", () => {
		expect(
			UploadPolicySchema.safeParse({ allowedContentTypes: ["image/*", "video/mp4", "*/*"], maxBytes: 10 }).success
		).toBe(true);
		expect(UploadPolicySchema.safeParse({ allowedContentTypes: ["*/png"], maxBytes: 10 }).success).toBe(false);
		expect(UploadPolicySchema.safeParse({ allowedContentTypes: [], maxBytes: 10 }).success).toBe(false);
	});
});
