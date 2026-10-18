import { ValidationError } from "@helios/contracts";
import type { Filter } from "mongodb";
import { mediaAssets, type MediaAsset } from "../models";

const DEFAULT_PAGE_SIZE = 25;
const CURSOR_SEPARATOR = "|";

export interface ListAssetsInput {
	externalId?: string;
	limit?: number;
	cursor?: string;
}

export interface AssetPage {
	assets: MediaAsset[];
	nextCursor?: string;
}

export async function listAssets(accountId: string, input: ListAssetsInput): Promise<AssetPage> {
	const size = input.limit ?? DEFAULT_PAGE_SIZE;
	const filter: Filter<MediaAsset> = {
		accountId,
		deletedAt: { $exists: false },
		...(input.externalId !== undefined && { externalId: input.externalId })
	};
	if (input.cursor !== undefined) {
		const { createdAt, id } = decodeCursor(input.cursor);
		filter.$or = [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: id } }];
	}
	const docs = await mediaAssets()
		.find(filter)
		.sort({ createdAt: -1, _id: -1 })
		.limit(size + 1)
		.toArray();
	const assets = docs.slice(0, size);
	const last = assets.at(-1);
	return { assets, ...(docs.length > size && last !== undefined && { nextCursor: encodeCursor(last) }) };
}

function encodeCursor(asset: MediaAsset): string {
	return Buffer.from(`${asset.createdAt.getTime()}${CURSOR_SEPARATOR}${asset._id}`).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
	const [millis, id] = Buffer.from(cursor, "base64url").toString("utf8").split(CURSOR_SEPARATOR);
	const createdAt = new Date(Number(millis));
	if (id === undefined || Number.isNaN(createdAt.getTime())) {
		throw new ValidationError("Invalid cursor");
	}
	return { createdAt, id };
}
