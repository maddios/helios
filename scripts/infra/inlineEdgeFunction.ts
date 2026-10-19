import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const TEMPLATE = path.join(ROOT, "infra", "cdn.yml");
const EDGE_SOURCE = path.join(ROOT, "infra", "edge", "imgRewrite.js");
const RENDERED = path.join(ROOT, "infra", "cdn.rendered.yml");
const PLACEHOLDER = "__IMG_REWRITE_SOURCE__";

export function renderCdnTemplate(template: string, edgeSource: string): string {
	const lines = template.split("\n");
	const placeholderLines = lines.filter((line) => line.trim() === PLACEHOLDER);
	if (placeholderLines.length !== 1) {
		throw new Error(`Expected exactly one ${PLACEHOLDER} line in the CDN template`);
	}
	return lines
		.flatMap((line) => {
			const indent = line.match(new RegExp(`^(\\s*)${PLACEHOLDER}$`))?.[1];
			if (indent === undefined) {
				return [line];
			}
			return edgeSource
				.trimEnd()
				.split("\n")
				.map((code) => (code.length === 0 ? "" : `${indent}${code}`));
		})
		.join("\n");
}

function main(): void {
	const rendered = renderCdnTemplate(fs.readFileSync(TEMPLATE, "utf8"), fs.readFileSync(EDGE_SOURCE, "utf8"));
	fs.writeFileSync(RENDERED, rendered);
	process.stdout.write(`Rendered ${path.relative(ROOT, RENDERED)}\n`);
}

if (require.main === module) {
	main();
}
