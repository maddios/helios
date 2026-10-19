import path from "node:path";
import { parseArgs } from "node:util";
import type { ModelEffort } from "@helios/core";

const EFFORTS: ModelEffort[] = ["low", "medium", "high"];

export interface EvalArgs {
	effort: ModelEffort;
	samplesDir: string;
	outDir: string;
	limit: number | undefined;
	judge: boolean;
	mock: boolean;
}

export function parseEvalArgs(argv: string[]): EvalArgs {
	const { values } = parseArgs({
		args: argv,
		options: {
			effort: { type: "string" },
			samples: { type: "string" },
			out: { type: "string" },
			limit: { type: "string" },
			judge: { type: "boolean", default: false },
			mock: { type: "boolean", default: false }
		}
	});
	if (!isEffort(values.effort)) {
		throw new Error("--effort is required and must be one of low, medium, high");
	}
	if (values.samples === undefined) {
		throw new Error("--samples <dir> is required");
	}
	if (values.out === undefined) {
		throw new Error("--out <dir> is required");
	}
	return {
		effort: values.effort,
		samplesDir: path.resolve(values.samples),
		outDir: path.resolve(values.out),
		limit: values.limit === undefined ? undefined : parseLimit(values.limit),
		judge: values.judge,
		mock: values.mock
	};
}

function isEffort(value: string | undefined): value is ModelEffort {
	return EFFORTS.some((effort) => effort === value);
}

function parseLimit(value: string): number {
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error("--limit must be a positive integer");
	}
	return limit;
}
