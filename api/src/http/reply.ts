import type { Response } from "express";

export interface Reply {
	status: number;
	body?: unknown;
}

export const reply = {
	ok: (body: unknown): Reply => ({ status: 200, body }),
	created: (body: unknown): Reply => ({ status: 201, body }),
	accepted: (body: unknown): Reply => ({ status: 202, body }),
	noContent: (): Reply => ({ status: 204 })
};

export function sendReply(res: Response, { status, body }: Reply): void {
	if (body === undefined) {
		res.status(status).end();
		return;
	}
	res.status(status).json(body);
}
