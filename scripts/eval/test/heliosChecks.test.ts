import type { Person, Scene } from "@helios/contracts";
import { coverageOk, personFieldCoverage, representativeShares, timesDrawn } from "../metrics/heliosChecks";

function scene(overrides: Partial<Scene>): Scene {
	return {
		sceneNumber: 1,
		startSec: 0,
		endSec: 10,
		reasonForTransition: "reason",
		transcriptExcerpt: null,
		description: "description",
		setting: "setting",
		products: [],
		people: [],
		representativeStillIndex: 0,
		...overrides
	};
}

function person(overrides: Partial<Person>): Person {
	return {
		species: null,
		genderPresentation: null,
		approximateAge: null,
		skinTone: null,
		skinUndertone: null,
		hairTexture: null,
		curlType: null,
		hairColor: null,
		hairLength: null,
		facialHair: null,
		visibleMakeup: null,
		mood: null,
		...overrides
	};
}

const contiguous: Scene[] = [
	scene({ sceneNumber: 1, startSec: 0, endSec: 10 }),
	scene({ sceneNumber: 2, startSec: 10, endSec: 30 })
];

describe("timesDrawn", () => {
	it("passes when every start is a provided time", () => {
		expect(timesDrawn(contiguous, [0, 3, 10])).toBe(true);
	});

	it("fails when a start was not provided", () => {
		expect(timesDrawn(contiguous, [0, 3])).toBe(false);
	});
});

describe("coverageOk", () => {
	it("passes for contiguous scenes covering [0, duration]", () => {
		expect(coverageOk(contiguous, 30)).toBe(true);
	});

	it("fails on a gap, a wrong end, a late start, a bad scene number or no scenes", () => {
		expect(coverageOk([contiguous[0], scene({ sceneNumber: 2, startSec: 12, endSec: 30 })], 30)).toBe(false);
		expect(coverageOk(contiguous, 40)).toBe(false);
		expect(coverageOk([scene({ startSec: 1, endSec: 30 })], 30)).toBe(false);
		expect(coverageOk([scene({ sceneNumber: 3, endSec: 30 })], 30)).toBe(false);
		expect(coverageOk([], 30)).toBe(false);
	});
});

describe("representativeShares", () => {
	const stills = [
		{ index: 0, timestampSec: 0, absPath: "/x/0.jpg" },
		{ index: 5, timestampSec: 15, absPath: "/x/5.jpg" }
	];

	it("counts stills that exist and fall inside their scene", () => {
		const scenes = [
			scene({ startSec: 0, endSec: 10, representativeStillIndex: 0 }),
			scene({ startSec: 10, endSec: 30, representativeStillIndex: 5 }),
			scene({ startSec: 10, endSec: 30, representativeStillIndex: 9 })
		];
		const shares = representativeShares(scenes, stills);
		expect(shares.valid).toBeCloseTo(2 / 3);
		expect(shares.inScene).toBeCloseTo(2 / 3);
	});

	it("reports a still outside its scene as valid but not in scene", () => {
		const shares = representativeShares([scene({ startSec: 0, endSec: 10, representativeStillIndex: 5 })], stills);
		expect(shares).toEqual({ valid: 1, inScene: 0 });
	});
});

describe("personFieldCoverage", () => {
	it("is null without people", () => {
		expect(personFieldCoverage([scene({})])).toBeNull();
	});

	it("is the share of non-null attribute fields", () => {
		const scenes = [scene({ people: [person({ genderPresentation: "feminine", mood: "calm" })] })];
		expect(personFieldCoverage(scenes)).toBeCloseTo(2 / 12);
	});
});
