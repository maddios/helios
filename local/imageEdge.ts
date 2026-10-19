import type { Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express, { type Request, type Response } from "express";
import { GetObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { config as coreConfig, logger } from "@helios/core";
import { handler as imageHandler, type ImageResponse } from "../functions/src/image/handler";
import { handler as edgeHandler, type EdgeRequest, type EdgeResponse } from "../infra/edge/imgRewrite";
import { applyLocalEnv, loadLocalConfig } from "./loadConfig";

export interface ImageEdgeStats {
	handlerInvocations: number;
}

export interface ImageEdge {
	url: string;
	stats: ImageEdgeStats;
	close(): Promise<void>;
}

interface Deps {
	s3: S3Client;
	bucket: string;
	stats: ImageEdgeStats;
}

const CACHE_MISS_STATUSES = [403, 404];

export async function startImageEdge(port: number): Promise<ImageEdge> {
	const env = coreConfig();
	const s3 = new S3Client({ region: env.AWS_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: true });
	const stats: ImageEdgeStats = { handlerInvocations: 0 };
	const deps: Deps = { s3, bucket: env.MEDIA_BUCKET, stats };
	const app = express();
	app.get("/img/*splat", (req, res) => serveImage(req, res, deps));
	const server: Server = app.listen(port);
	await once(server, "listening");
	return {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		stats,
		close: async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			s3.destroy();
		}
	};
}

async function serveImage(req: Request, res: Response, deps: Deps): Promise<void> {
	const decision = edgeHandler({ request: toEdgeRequest(req) });
	if ("statusCode" in decision) {
		sendEdgeResponse(res, decision);
		return;
	}
	const cached = await readVariant(deps, decision.uri);
	if (cached !== undefined) {
		sendBytes(res, 200, cached);
		return;
	}
	deps.stats.handlerInvocations += 1;
	sendLambdaResponse(res, await imageHandler({ rawPath: decision.uri, rawQueryString: versionQuery(req) }));
}

function versionQuery(req: Request): string {
	const version = new URL(req.originalUrl, "http://localhost").searchParams.get("v");
	return version === null ? "" : `v=${encodeURIComponent(version)}`;
}

function toEdgeRequest(req: Request): EdgeRequest {
	const querystring: EdgeRequest["querystring"] = {};
	for (const [name, value] of Object.entries(req.query)) {
		if (typeof value === "string") {
			querystring[name] = { value };
		}
	}
	return { method: "GET", uri: req.path, querystring, headers: {} };
}

function sendEdgeResponse(res: Response, response: EdgeResponse): void {
	for (const [name, header] of Object.entries(response.headers)) {
		res.setHeader(name, header.value);
	}
	res.status(response.statusCode).send(response.body?.data ?? "");
}

interface Bytes {
	body: Buffer;
	contentType?: string;
	cacheControl?: string;
}

async function readVariant({ s3, bucket }: Deps, uri: string): Promise<Bytes | undefined> {
	try {
		const { Body, ContentType, CacheControl } = await s3.send(
			new GetObjectCommand({ Bucket: bucket, Key: `resize_cache${uri}` })
		);
		if (Body === undefined) {
			return undefined;
		}
		return {
			body: Buffer.from(await Body.transformToByteArray()),
			contentType: ContentType,
			cacheControl: CacheControl
		};
	} catch (err) {
		if (err instanceof S3ServiceException && CACHE_MISS_STATUSES.includes(err.$metadata.httpStatusCode ?? 0)) {
			return undefined;
		}
		throw err;
	}
}

function sendBytes(res: Response, status: number, { body, contentType, cacheControl }: Bytes): void {
	if (contentType !== undefined) {
		res.setHeader("content-type", contentType);
	}
	if (cacheControl !== undefined) {
		res.setHeader("cache-control", cacheControl);
	}
	res.status(status).send(body);
}

function sendLambdaResponse(res: Response, response: ImageResponse): void {
	for (const [name, value] of Object.entries(response.headers ?? {})) {
		res.setHeader(name, value);
	}
	res.status(response.statusCode).send(Buffer.from(response.body ?? "", response.isBase64Encoded ? "base64" : "utf8"));
}

if (require.main === module) {
	const local = loadLocalConfig();
	applyLocalEnv(local, { e2e: false });
	startImageEdge(local.img.port)
		.then((edge) => logger().info({ url: edge.url }, "Image edge listening"))
		.catch((err: unknown) => {
			logger().error({ err }, "Image edge failed to start");
			process.exitCode = 1;
		});
}
