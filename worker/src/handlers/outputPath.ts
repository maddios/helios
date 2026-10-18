import path from "node:path";

export function localOutputPath(workDir: string, template: string, assetId: string): string {
	return path.join(workDir, template.replaceAll("{id}", assetId));
}
