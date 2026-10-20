import { ValidationError } from "@helios/contracts";
import type { Collection, Filter, WithId } from "mongodb";

const DEFAULT_PAGE_SIZE = 25;
const CURSOR_SEPARATOR = "|";

export interface PageInput {
	limit?: number;
	cursor?: string;
}

export interface Page<T> {
	docs: T[];
	nextCursor?: string;
}

interface Keyset {
	_id: string;
	createdAt: Date;
}

export async function findPage<T extends Keyset>(
	collection: Collection<T>,
	filter: Filter<T>,
	input: PageInput
): Promise<Page<WithId<T>>> {
	const size = input.limit ?? DEFAULT_PAGE_SIZE;
	const query: Filter<T> = { ...filter };
	if (input.cursor !== undefined) {
		const { createdAt, id } = decodeCursor(input.cursor);
		query.$or = [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: id } }] as Filter<T>["$or"];
	}
	const found = await collection
		.find(query)
		.sort({ createdAt: -1, _id: -1 })
		.limit(size + 1)
		.toArray();
	const docs = found.slice(0, size);
	const last = docs.at(-1);
	return { docs, ...(found.length > size && last !== undefined && { nextCursor: encodeCursor(last) }) };
}

function encodeCursor(doc: WithId<Keyset> | Keyset): string {
	return Buffer.from(`${doc.createdAt.getTime()}${CURSOR_SEPARATOR}${doc._id}`).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
	const [millis, id] = Buffer.from(cursor, "base64url").toString("utf8").split(CURSOR_SEPARATOR);
	const createdAt = new Date(Number(millis));
	if (id === undefined || Number.isNaN(createdAt.getTime())) {
		throw new ValidationError("Invalid cursor");
	}
	return { createdAt, id };
}
