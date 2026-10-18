import { PresetSchema } from "@helios/contracts";
import { genericPreset } from "../src/presets";

describe("PresetSchema", () => {
	it("accepts the generic preset", () => {
		expect(PresetSchema.safeParse(genericPreset).success).toBe(true);
	});

	it("rejects two default profiles for the same source type", () => {
		const preset = {
			...genericPreset,
			profiles: genericPreset.profiles.map((profile) =>
				profile.name === "mp4_720" ? { ...profile, isDefault: true } : profile
			)
		};
		expect(PresetSchema.safeParse(preset).success).toBe(false);
	});

	it("rejects a child profile that is not stills", () => {
		const preset = {
			...genericPreset,
			profiles: genericPreset.profiles.map((profile) =>
				profile.name === "mp4_360" ? { ...profile, children: ["audio"] } : profile
			)
		};
		expect(PresetSchema.safeParse(preset).success).toBe(false);
	});

	it("rejects a default profile that is neither video nor image", () => {
		const preset = {
			...genericPreset,
			profiles: genericPreset.profiles.map((profile) => {
				if (profile.name === "mp4_360") {
					return { ...profile, isDefault: false };
				}
				return profile.name === "audio" ? { ...profile, isDefault: true } : profile;
			})
		};
		expect(PresetSchema.safeParse(preset).success).toBe(false);
	});

	it("rejects an unknown child profile", () => {
		const preset = {
			...genericPreset,
			profiles: genericPreset.profiles.map((profile) =>
				profile.name === "mp4_360" ? { ...profile, children: ["missing"] } : profile
			)
		};
		expect(PresetSchema.safeParse(preset).success).toBe(false);
	});

	it("rejects duplicate profile names", () => {
		const preset = {
			...genericPreset,
			profiles: [...genericPreset.profiles, genericPreset.profiles[0]]
		};
		expect(PresetSchema.safeParse(preset).success).toBe(false);
	});

	describe("profile parameter ranges", () => {
		function withParams(name: string, params: Record<string, unknown>) {
			return {
				...genericPreset,
				profiles: genericPreset.profiles.map((profile) =>
					profile.name === name ? { ...profile, params: { ...profile.params, ...params } } : profile
				)
			} as unknown;
		}

		it.each([
			["mp4_360", { height: 0 }],
			["mp4_360", { height: 4321 }],
			["mp4_360", { videoBitrateK: 100001 }],
			["mp4_360", { audioBitrateK: 513 }],
			["mp4_360", { audioSampleRate: 32000 }],
			["mp4_360", { fps: 121 }],
			["mp4_360", { gopSeconds: 0 }],
			["mp4_360", { x264Preset: "bogus" }],
			["mp4_360", { x264Profile: "high444" }],
			["stills", { fps: "abc" }],
			["stills", { fps: "1/0/2" }],
			["stills", { maxCount: 0 }],
			["audio", { bitrateK: 321 }],
			["audio", { sampleRate: 96000 }]
		])("rejects %s with %o", (name, params) => {
			expect(PresetSchema.safeParse(withParams(name, params)).success).toBe(false);
		});

		it("accepts the boundary values", () => {
			expect(
				PresetSchema.safeParse(
					withParams("mp4_360", { height: 4320, videoBitrateK: 100000, audioBitrateK: 512, fps: 120 })
				).success
			).toBe(true);
			expect(PresetSchema.safeParse(withParams("stills", { fps: "1/3" })).success).toBe(true);
		});
	});
});
