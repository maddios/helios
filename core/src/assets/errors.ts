import { ConflictError, ValidationError } from "@helios/contracts";

export class InvalidStillIndexError extends ValidationError {
	constructor(index: number, count: number) {
		super(`Still index ${index} is out of range; the asset has ${count} stills`);
	}
}

export class AmbiguousStillsError extends ConflictError {
	constructor(assetId: string, count: number) {
		super(`Asset ${assetId} has ${count} stills outputs; the active still is ambiguous`, undefined, "ambiguous_stills");
	}
}
