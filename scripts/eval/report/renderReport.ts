import type { Person, Scene } from "@helios/contracts";
import type { Aggregate } from "../metrics/aggregate";
import type { BaselineScene, EvalSample, SampleMetrics, SampleReport } from "../types";
import { esc, formatMs, formatSec, num, pct, relativeHref } from "./format";
import { STYLES } from "./styles";

export interface ReportInput {
	reportDir: string;
	effort: string;
	mock: boolean;
	generatedAt: string;
	aggregate: Aggregate;
	reports: SampleReport[];
	samples: EvalSample[];
}

type Tone = "good" | "bad" | "";

export function renderReport(input: ReportInput): string {
	const videos = input.reports.map((report) => videoSection(report, input));
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scene eval ${esc(input.effort)}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
<h1>Scene eval: ${esc(input.effort)}</h1>
<p class="muted">${input.mock ? "Mock OpenAI" : "Real OpenAI"} · ${esc(input.generatedAt)} · ${input.reports.length} videos</p>
</header>
<main>
<section>
<h2>Aggregate</h2>
${aggregateTable(input.aggregate)}
</section>
${videos.join("\n")}
</main>
</body>
</html>
`;
}

function aggregateTable(aggregate: Aggregate): string {
	const { boundaries, judge, tokens } = aggregate;
	const rows: [string, string][] = [
		["Videos ok", `${aggregate.samples - aggregate.failed} of ${aggregate.samples}`],
		["Schema valid", pct(aggregate.schemaValid)],
		["Times drawn from provided times", pct(aggregate.timesDrawn)],
		["Coverage and order", pct(aggregate.coverageOk)],
		["Mean scenes (Helios / partnrup)", `${num(aggregate.meanHeliosScenes)} / ${num(aggregate.meanPartnrupScenes)}`],
		[
			"Boundary precision / recall / F1 (±3 s, per video)",
			`${pct(boundaries.precision)} / ${pct(boundaries.recall)} / ${pct(boundaries.f1)}`
		],
		[
			"Representative still valid / in scene",
			`${pct(aggregate.representativeValid)} / ${pct(aggregate.representativeInScene)}`
		],
		["People field coverage", pct(aggregate.personFieldCoverage)],
		["Partnrup invalid timestamps", String(aggregate.partnrupInvalid)],
		["Tokens in / out", `${tokens.inputTokens} / ${tokens.outputTokens}`],
		["Mean latency", aggregate.meanLatencyMs === null ? "n/a" : formatMs(aggregate.meanLatencyMs)],
		[
			"Judge boundary / description / completeness (1-5)",
			`${num(judge.boundaryQuality)} / ${num(judge.descriptionAccuracy)} / ${num(judge.completeness)}`
		],
		["Judge failures", String(aggregate.judgeFailed)]
	];
	const body = rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join("");
	return `<div class="table-wrap"><table class="kv"><tbody>${body}</tbody></table></div>`;
}

function videoSection(report: SampleReport, input: ReportInput): string {
	const heading = `<h3>Media ${report.mediaId} <span class="muted">${formatSec(report.durationSec)}</span></h3>`;
	if (report.error !== undefined || report.helios === undefined || report.metrics === undefined) {
		return `<article class="video">${heading}<p class="error">${esc(report.error ?? "No result")}</p></article>`;
	}
	const sample = input.samples.find((candidate) => candidate.mediaId === report.mediaId);
	const helios = report.helios.scenes.map((scene) => heliosRow(scene, stillHref(input.reportDir, sample, scene)));
	const partnrup = report.partnrup.scenes.map(partnrupRow);
	const judge = report.judge === undefined ? "" : `<p class="meta">Judge: ${esc(report.judge.rationale)}</p>`;
	return `<article class="video">
${heading}
<div class="badges">${badges(report, report.metrics)}</div>
<div class="pair">
<div class="table-wrap"><h4>Partnrup (${report.partnrup.scenes.length})</h4>${table(["Start", "Reason", "Description"], partnrup)}</div>
<div class="table-wrap"><h4>Helios (${report.helios.scenes.length})</h4>${table(["Time", "Reason", "Description", "Still"], helios)}</div>
</div>
${judge}
</article>`;
}

function badges(report: SampleReport, metrics: SampleMetrics): string {
	const { boundaries } = metrics;
	const items: [string, string, Tone][] = [
		["schema", passFail(metrics.schemaValid), passTone(metrics.schemaValid)],
		["times", passFail(metrics.timesDrawn), passTone(metrics.timesDrawn)],
		["coverage", passFail(metrics.coverageOk), passTone(metrics.coverageOk)],
		["scenes", `${metrics.heliosSceneCount} vs ${metrics.partnrupSceneCount}`, ""],
		["P / R / F1", `${pct(boundaries.precision)} / ${pct(boundaries.recall)} / ${pct(boundaries.f1)}`, ""],
		["people", pct(metrics.personFieldCoverage), ""],
		["rep. valid", pct(metrics.representativeValid), ""],
		["rep. in scene", pct(metrics.representativeInScene), ""],
		["tokens", `${report.usage.inputTokens} in / ${report.usage.outputTokens} out`, ""],
		["latency", formatMs(report.latencyMs), ""],
		["partnrup invalid", String(report.partnrup.invalidCount), ""]
	];
	if (report.judge !== undefined) {
		const { boundaryQuality, descriptionAccuracy, completeness } = report.judge;
		items.push(["judge", `${boundaryQuality} / ${descriptionAccuracy} / ${completeness}`, ""]);
	}
	return items
		.map(([label, value, tone]) => `<span class="badge ${tone}"><b>${esc(label)}</b> ${esc(value)}</span>`)
		.join("");
}

function passFail(value: boolean): string {
	return value ? "pass" : "fail";
}

function passTone(value: boolean): Tone {
	return value ? "good" : "bad";
}

function table(headers: string[], rows: string[]): string {
	const head = headers.map((header) => `<th>${esc(header)}</th>`).join("");
	return `<table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function partnrupRow(scene: BaselineScene): string {
	return `<tr><td>${formatSec(scene.startSec)}</td><td>${esc(scene.reason)}</td><td>${esc(scene.description)}</td></tr>`;
}

function heliosRow(scene: Scene, still: string | undefined): string {
	const image =
		still === undefined ? "" : `<img class="still" src="${esc(still)}" alt="Representative still" loading="lazy">`;
	return `<tr>
<td>${formatSec(scene.startSec)}–${formatSec(scene.endSec)}</td>
<td>${esc(scene.reasonForTransition)}</td>
<td>${esc(scene.description)}
<div class="meta">Setting: ${esc(scene.setting)}</div>
<div class="meta">Products: ${esc(productsSummary(scene))}</div>
<div class="meta">People: ${esc(peopleSummary(scene.people))}</div></td>
<td>${image}</td>
</tr>`;
}

function stillHref(reportDir: string, sample: EvalSample | undefined, scene: Scene): string | undefined {
	const still = sample?.stills.find((candidate) => candidate.index === scene.representativeStillIndex);
	return still === undefined ? undefined : relativeHref(reportDir, still.absPath);
}

function productsSummary(scene: Scene): string {
	return scene.products.length === 0
		? "none"
		: scene.products.map((product) => `${product.type}: ${product.name}`).join("; ");
}

function peopleSummary(people: Person[]): string {
	if (people.length === 0) {
		return "none";
	}
	return people
		.map((person) =>
			[
				person.genderPresentation,
				person.approximateAge,
				person.skinTone,
				person.hairTexture,
				person.visibleMakeup,
				person.mood
			]
				.filter((value): value is string => value !== null)
				.join(", ")
		)
		.map((summary) => summary || "no attributes")
		.join("; ");
}
