/**
 * Maps each API operation, written `METHOD /path` as in the OpenAPI document, to the SDK method that calls it.
 *
 * Method names are dotted paths on {@link Helios}, or on {@link HeliosAdmin} when prefixed with `admin.`. The contract
 * test checks this map against the generated document in both directions, so an operation added to the API without an
 * SDK method, or a method removed from the SDK, fails the build.
 */
export const OPERATIONS: Readonly<Record<string, string>> = {
	"GET /health": "health",
	"GET /ready": "ready",
	"GET /openapi.json": "openapi",
	"POST /encode": "encodes.create",
	"POST /assets/{id}/re-encode": "encodes.reencode",
	"GET /assets": "assets.list",
	"GET /assets/{id}": "assets.get",
	"DELETE /assets/{id}": "assets.delete",
	"PATCH /assets/{id}/active-still": "assets.setActiveStill",
	"GET /assets/{id}/transcripts": "assets.transcripts",
	"GET /assets/{id}/scenes": "assets.scenes",
	"POST /assets/{id}/post-process": "assets.postProcess",
	"GET /requests/{id}": "requests.get",
	"DELETE /requests/{id}": "requests.cancel",
	"GET /requests/{id}/callbacks": "requests.callbacks.list",
	"POST /requests/{id}/callbacks/redeliver": "requests.callbacks.redeliver",
	"POST /uploads/presigned": "uploads.presign",
	"POST /uploads/multipart": "uploads.createMultipart",
	"POST /uploads/multipart/{uploadId}/complete": "uploads.completeMultipart",
	"POST /uploads/multipart/{uploadId}/parts": "uploads.signParts",
	"GET /uploads/multipart/{uploadId}/parts": "uploads.listParts",
	"DELETE /uploads/multipart/{uploadId}": "uploads.abortMultipart",
	"POST /files": "files.create",
	"GET /presets": "presets.list",
	"POST /presets": "presets.create",
	"GET /presets/{name}": "presets.get",
	"PATCH /presets/{name}": "presets.update",
	"DELETE /presets/{name}": "presets.delete",
	"POST /presets/{name}/profiles": "presets.addProfile",
	"PATCH /presets/{name}/profiles/{profile}": "presets.updateProfile",
	"DELETE /presets/{name}/profiles/{profile}": "presets.removeProfile",
	"POST /presets/{name}/clone": "presets.clone",
	"POST /presets/{name}/dry-run": "presets.dryRun",
	"GET /account/destination": "account.getDestination",
	"PUT /account/destination": "account.setDestination",
	"POST /destinations/test": "destinations.test",
	"GET /destinations/eventbridge/policy": "destinations.eventBridgePolicy",
	"GET /usage": "usage.get",
	"GET /admin/accounts": "admin.accounts.list",
	"POST /admin/accounts": "admin.accounts.create",
	"PATCH /admin/accounts/{id}": "admin.accounts.update",
	"POST /admin/accounts/{id}/webhook-secret/rotate": "admin.accounts.rotateWebhookSecret",
	"POST /admin/accounts/{id}/keys": "admin.keys.create",
	"DELETE /admin/accounts/{id}/keys/{keyId}": "admin.keys.revoke",
	"POST /admin/accounts/{id}/destinations/test": "admin.destinations.test",
	"GET /admin/presets": "admin.presets.list",
	"POST /admin/presets": "admin.presets.create",
	"GET /admin/presets/{name}": "admin.presets.get",
	"PATCH /admin/presets/{name}": "admin.presets.update",
	"DELETE /admin/presets/{name}": "admin.presets.delete",
	"GET /admin/usage": "admin.usage.get"
};

/** Routes that serve documentation rather than API data, so they have no SDK method. */
export const NON_OPERATIONS: readonly string[] = ["GET /docs"];
