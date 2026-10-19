import { readFileSync, readdirSync } from "node:fs";

const sdk = new URL("..", import.meta.url);
const normalize = (text) =>
	text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");

const examples = readdirSync(new URL("examples/", sdk))
	.filter((name) => name.endsWith(".ts"))
	.map((name) => normalize(readFileSync(new URL(`examples/${name}`, sdk), "utf8")));

const containsRun = (lines, run) =>
	lines.some((_, start) => run.every((line, offset) => lines[start + offset] === line));

const failures = [];
for (const doc of ["README.md", "AGENTS.md", "llms.txt"]) {
	const text = readFileSync(new URL(doc, sdk), "utf8");
	for (const [, block] of text.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g)) {
		const run = normalize(block);
		if (!examples.some((lines) => containsRun(lines, run))) {
			failures.push(`${doc}: snippet is not a verbatim run of lines from sdk/examples: "${run[0]}"`);
		}
	}
}

if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
console.log("doc snippets match sdk/examples");
