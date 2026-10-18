import express, { type Express } from "express";
import swaggerUi from "swagger-ui-express";
import { apiEndpoints } from "./routes";
import { buildOpenApiDocument } from "./openapi/document";
import { mountEndpoint } from "./http/endpoint";
import { authenticate } from "./middleware/authenticate";
import { errorHandler } from "./middleware/errorHandler";
import { jsonBody } from "./middleware/jsonBody";
import { notFound } from "./middleware/notFound";
import { requestId } from "./middleware/requestId";

export function createApp(): Express {
	const app = express();
	app.disable("x-powered-by");
	app.use(requestId(), jsonBody());

	const router = express.Router();
	for (const spec of apiEndpoints) {
		mountEndpoint(router, spec);
	}
	app.use(router);

	const document = buildOpenApiDocument(apiEndpoints);
	const docsAuth = authenticate("any");
	app.get("/openapi.json", docsAuth, (_req, res) => {
		res.json(document);
	});
	app.use("/docs", docsAuth, swaggerUi.serve, swaggerUi.setup(document));

	app.use(notFound(), errorHandler());
	return app;
}
