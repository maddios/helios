import { type Person, PersonSchema, type Scene } from "@helios/contracts";
import type { SampleStill } from "../types";
import { ratio } from "./stats";

const PERSON_FIELD_COUNT = Object.keys(PersonSchema.shape).length;

export function timesDrawn(scenes: Scene[], provided: number[]): boolean {
	const allowed = new Set(provided);
	return scenes.every((scene) => allowed.has(scene.startSec));
}

export function coverageOk(scenes: Scene[], durationSec: number): boolean {
	const first = scenes[0];
	const last = scenes.at(-1);
	if (first === undefined || last === undefined) {
		return false;
	}
	const contiguous = scenes.every((scene, index) => {
		const next = scenes[index + 1];
		return (
			scene.sceneNumber === index + 1 &&
			scene.startSec < scene.endSec &&
			(next === undefined || next.startSec === scene.endSec)
		);
	});
	return first.startSec === 0 && last.endSec === durationSec && contiguous;
}

export function representativeShares(scenes: Scene[], stills: SampleStill[]): { valid: number; inScene: number } {
	const byIndex = new Map(stills.map((still) => [still.index, still] as const));
	const valid = scenes.filter((scene) => byIndex.has(scene.representativeStillIndex)).length;
	const inScene = scenes.filter((scene) => {
		const still = byIndex.get(scene.representativeStillIndex);
		return still !== undefined && still.timestampSec >= scene.startSec && still.timestampSec <= scene.endSec;
	}).length;
	return { valid: ratio(valid, scenes.length), inScene: ratio(inScene, scenes.length) };
}

export function personFieldCoverage(scenes: Scene[]): number | null {
	const people: Person[] = scenes.flatMap((scene) => scene.people);
	if (people.length === 0) {
		return null;
	}
	const filled = people.reduce(
		(total, person) => total + Object.values(person).filter((value) => value !== null).length,
		0
	);
	return filled / (people.length * PERSON_FIELD_COUNT);
}
