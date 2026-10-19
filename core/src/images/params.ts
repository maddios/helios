import { ImageError } from "./errors";
import { CROP_MODES, GRAVITIES, IMAGE_FORMATS, type ImageTransform } from "./types";

const PARAM_ORDER = ["w", "h", "c", "g", "b", "q", "f"] as const;
type ParamName = (typeof PARAM_ORDER)[number];
const DEFAULT_VALUES: Partial<Record<ParamName, string>> = { c: "fit" };
type RawParams = Partial<Record<ParamName, string>>;

const MAX_DIMENSION = 4096;
const MAX_QUALITY = 100;
const TOKEN_PATTERN = /^([a-z])_(.+)$/;
const INTEGER_PATTERN = /^[1-9][0-9]{0,3}$/;
const HEX_PATTERN = /^[0-9a-f]{6}$/;

function isParamName(name: string): name is ParamName {
	return (PARAM_ORDER as readonly string[]).includes(name);
}

function readRawParams(segment: string): RawParams {
	const raw: RawParams = {};
	for (const token of segment.split(",")) {
		const match = TOKEN_PATTERN.exec(token);
		if (match === null) {
			throw new ImageError("malformed_param", `Malformed image parameter "${token}"`);
		}
		const [, name, value] = match;
		if (!isParamName(name)) {
			throw new ImageError("unknown_param", `Unknown image parameter "${name}"`);
		}
		if (raw[name] !== undefined) {
			throw new ImageError("duplicate_param", `Duplicate image parameter "${name}"`);
		}
		raw[name] = value;
	}
	return raw;
}

function invalidValue(name: ParamName, value: string): ImageError {
	return new ImageError("invalid_value", `Invalid value "${value}" for image parameter "${name}"`);
}

function integer(name: ParamName, value: string | undefined, max: number): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!INTEGER_PATTERN.test(value) || parsed > max) {
		throw invalidValue(name, value);
	}
	return parsed;
}

function choice<T extends string>(name: ParamName, value: string | undefined, options: readonly T[]): T | undefined {
	if (value === undefined) {
		return undefined;
	}
	const match = options.find((option) => option === value);
	if (match === undefined) {
		throw invalidValue(name, value);
	}
	return match;
}

function hexColor(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!HEX_PATTERN.test(value)) {
		throw invalidValue("b", value);
	}
	return value;
}

function assertDependencies(transform: ImageTransform): void {
	if (transform.w === undefined && transform.h === undefined) {
		throw new ImageError("missing_dimension", "At least one of w or h is required");
	}
	if (transform.b !== undefined && transform.c !== "pad") {
		throw new ImageError("not_applicable", "Parameter b requires c_pad");
	}
	if (transform.g !== undefined && transform.c !== "fill") {
		throw new ImageError("not_applicable", "Parameter g requires c_fill");
	}
}

export function parseImageParams(segment: string): ImageTransform {
	const raw = readRawParams(segment);
	const transform: ImageTransform = {
		w: integer("w", raw.w, MAX_DIMENSION),
		h: integer("h", raw.h, MAX_DIMENSION),
		c: choice("c", raw.c, CROP_MODES),
		g: choice("g", raw.g, GRAVITIES),
		b: hexColor(raw.b),
		q: integer("q", raw.q, MAX_QUALITY),
		f: choice("f", raw.f, IMAGE_FORMATS)
	};
	assertDependencies(transform);
	return transform;
}

export function canonicalParams(transform: ImageTransform): string {
	return PARAM_ORDER.flatMap((name) =>
		transform[name] === undefined || transform[name] === DEFAULT_VALUES[name] ? [] : [`${name}_${transform[name]}`]
	).join(",");
}
