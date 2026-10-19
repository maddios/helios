import type { Person, Scene } from "@helios/contracts";
import { forEachLimit } from "../transcribe/forEachLimit";
import type { SceneWindow } from "./windowing";
import type { ModelDraft } from "./schemas";
import { type DraftScene, type ResolvedStill, type StillInput, SceneOutputError } from "./types";

export function snapTime(time: number, allowed: number[], toleranceSec: number): number {
	const nearest = allowed.reduce((best, candidate) =>
		Math.abs(candidate - time) < Math.abs(best - time) ? candidate : best
	);
	if (Math.abs(nearest - time) > toleranceSec) {
		throw new SceneOutputError(`Scene start ${time}s is not within ${toleranceSec}s of a provided time`);
	}
	return nearest;
}

export function resolveWindowDrafts(
	drafts: ModelDraft[],
	window: SceneWindow,
	allowed: number[],
	toleranceSec: number,
	mayContinue: boolean
): DraftScene[] {
	if (drafts.length === 0) {
		throw new SceneOutputError(`Window ${window.index} returned no scenes`);
	}
	const provided = new Set(window.stills.map((still) => still.index));
	return drafts.map((draft, position) => {
		if (!provided.has(draft.representativeStillIndex)) {
			throw new SceneOutputError(`representativeStillIndex ${draft.representativeStillIndex} was not provided`);
		}
		return {
			...draft,
			people: draft.people ?? [],
			startSec: snapTime(draft.startSec, allowed, toleranceSec),
			continuesPrevious: mayContinue && position === 0 && draft.continuesPrevious
		};
	});
}

export async function resolveStills(
	stills: StillInput[],
	resolveImage: (key: string) => Promise<string>,
	concurrency: number,
	signal: AbortSignal
): Promise<ResolvedStill[]> {
	const resolved: ResolvedStill[] = new Array(stills.length);
	const tasks = stills.map((still, position) => ({ still, position }));
	await forEachLimit(tasks, concurrency, signal, async ({ still, position }) => {
		resolved[position] = {
			index: still.index,
			timestampSec: still.timestampSec,
			imageUrl: await resolveImage(still.key)
		};
	});
	return resolved;
}

export function unionPeople(scenes: { people: Person[] }[]): Person[] {
	return uniqueBy(
		scenes.flatMap((scene) => scene.people),
		(person) => JSON.stringify(person)
	);
}

export function mergeDrafts(earlier: DraftScene, later: DraftScene): DraftScene {
	return {
		...earlier,
		products: uniqueBy([...earlier.products, ...later.products], (product) => `${product.type}\u0000${product.name}`),
		people: uniqueBy([...earlier.people, ...later.people], (person) => JSON.stringify(person))
	};
}

function uniqueBy<T>(items: T[], keyOf: (item: T) => string): T[] {
	const seen = new Map<string, T>();
	for (const item of items) {
		seen.set(keyOf(item), item);
	}
	return [...seen.values()];
}

export function stitchDrafts(drafts: DraftScene[]): DraftScene[] {
	const stitched: DraftScene[] = [];
	for (const draft of drafts) {
		const last = stitched.at(-1);
		if (last !== undefined && draft.continuesPrevious) {
			stitched[stitched.length - 1] = mergeDrafts(last, draft);
		} else {
			stitched.push(draft);
		}
	}
	return stitched;
}

export function toCoverage(drafts: DraftScene[], durationSec: number): Scene[] {
	const [first, ...rest] = drafts;
	if (first === undefined) {
		throw new SceneOutputError("The model returned no scenes");
	}
	const kept: DraftScene[] = [{ ...first, startSec: 0 }];
	for (const draft of rest) {
		const last = kept[kept.length - 1];
		if (draft.startSec < last.startSec) {
			throw new SceneOutputError("Scene starts are out of order");
		}
		if (draft.startSec === last.startSec || draft.startSec >= durationSec) {
			kept[kept.length - 1] = mergeDrafts(last, draft);
		} else {
			kept.push(draft);
		}
	}
	return kept.map((draft, position) => toScene(draft, position, kept[position + 1]?.startSec ?? durationSec));
}

export function assertStillsWithinScenes(scenes: Scene[], stills: StillInput[]): void {
	const timeOf = new Map(stills.map((still) => [still.index, still.timestampSec]));
	for (const scene of scenes) {
		const time = timeOf.get(scene.representativeStillIndex);
		if (time === undefined || time < scene.startSec || time >= scene.endSec) {
			throw new SceneOutputError(
				`Scene ${scene.sceneNumber} representative still ${scene.representativeStillIndex} is not within the scene`
			);
		}
	}
}

function toScene(draft: DraftScene, position: number, endSec: number): Scene {
	const { continuesPrevious: _continuesPrevious, ...fields } = draft;
	return { ...fields, sceneNumber: position + 1, endSec };
}
