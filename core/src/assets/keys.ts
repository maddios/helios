import path from "node:path";

export function assetPrefix(slug: string, assetId: string): string {
	return `${slug}/media/${assetId}/`;
}

export function outputKey(slug: string, assetId: string, template: string): string {
	return `${assetPrefix(slug, assetId)}${template.replaceAll("{id}", assetId)}`;
}

export function stillKey(slug: string, assetId: string, template: string, fileName: string): string {
	return outputKey(slug, assetId, path.posix.join(path.posix.dirname(template), fileName));
}

export function stillsPrefix(slug: string, assetId: string, template: string): string {
	const dir = path.posix.dirname(template);
	if (dir === ".") {
		throw new Error(`Stills template ${template} must include a directory`);
	}
	return outputKey(slug, assetId, `${dir}/`);
}
