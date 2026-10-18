import type { RequestHandler, Router } from "express";
import type { ZodType, z } from "zod";
import type { Account, contextLogger } from "@helios/core";
import { authenticate } from "../middleware/authenticate";
import { validate } from "../middleware/validate";
import { sendReply, type Reply } from "./reply";

export type AuthScope = "none" | "account" | "admin";
export type HttpMethod = "get" | "post" | "patch" | "delete";

type Output<T> = T extends ZodType ? z.output<T> : undefined;

export interface ResponseSpec {
	description: string;
	schema?: ZodType;
}

export interface InputSpec<
	P extends ZodType | undefined,
	Q extends ZodType | undefined,
	B extends ZodType | undefined
> {
	params?: P;
	query?: Q;
	body?: B;
}

export interface HandlerContext<
	A extends AuthScope,
	P extends ZodType | undefined,
	Q extends ZodType | undefined,
	B extends ZodType | undefined
> {
	input: { params: Output<P>; query: Output<Q>; body: Output<B> };
	account: A extends "account" ? Account : undefined;
	log: ReturnType<typeof contextLogger>;
}

export interface EndpointSpec<
	A extends AuthScope,
	P extends ZodType | undefined,
	Q extends ZodType | undefined,
	B extends ZodType | undefined
> {
	method: HttpMethod;
	path: string;
	summary: string;
	auth: A;
	input?: InputSpec<P, Q, B>;
	responses: Record<number, ResponseSpec>;
	errors?: number[];
	handle(ctx: HandlerContext<A, P, Q, B>): Promise<Reply>;
}

export type AnyEndpoint = EndpointSpec<AuthScope, ZodType | undefined, ZodType | undefined, ZodType | undefined>;

export function endpoint<
	A extends AuthScope,
	P extends ZodType | undefined = undefined,
	Q extends ZodType | undefined = undefined,
	B extends ZodType | undefined = undefined
>(spec: EndpointSpec<A, P, Q, B>): AnyEndpoint {
	return spec as AnyEndpoint;
}

type Register = (router: Router, path: string, ...handlers: RequestHandler[]) => Router;

const registrars: Record<HttpMethod, Register> = {
	get: (router, path, ...handlers) => router.get(path, ...handlers),
	post: (router, path, ...handlers) => router.post(path, ...handlers),
	patch: (router, path, ...handlers) => router.patch(path, ...handlers),
	delete: (router, path, ...handlers) => router.delete(path, ...handlers)
};

export function toExpressPath(path: string): string {
	return path.replace(/\{(\w+)\}/g, ":$1");
}

export function mountEndpoint(router: Router, spec: AnyEndpoint): void {
	const guards: RequestHandler[] = spec.auth === "none" ? [] : [authenticate(spec.auth)];
	registrars[spec.method](
		router,
		toExpressPath(spec.path),
		...guards,
		validate(spec.input ?? {}),
		async (_req, res) => {
			const result = await spec.handle({ input: res.locals.input, account: res.locals.account, log: res.locals.log });
			sendReply(res, result);
		}
	);
}
