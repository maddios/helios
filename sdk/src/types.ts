import type { z } from "zod";
import type {
	AssetPostProcessRequestSchema,
	CreateAccountRequestSchema,
	EncodeOptionsSchema,
	EncodeRequestSchema,
	MultipartCompleteRequestSchema,
	ReencodeRequestSchema,
	UpdateAccountRequestSchema
} from "@helios/contracts";

/**
 * Body of `encodes.create`: the media source, the preset to encode with and optional post-processing.
 *
 * Request bodies use the zod input shape, so fields with server defaults (such as `analyze`, which defaults to
 * `"async"`) and the `callbackUrl` shorthand can be omitted.
 *
 * @example
 * const request: EncodeRequest = { source: { bucket: "bella-sources", key: "clip.mp4" }, preset: "generic" };
 */
export type EncodeRequest = z.input<typeof EncodeRequestSchema>;

/**
 * Encode options without a source, used when encoding an upload that was just stored.
 *
 * @example
 * const options: EncodeOptions = { preset: "generic", callbackUrl: "https://example.com/hook" };
 */
export type EncodeOptions = z.input<typeof EncodeOptionsSchema>;

/**
 * Body of `encodes.reencode`: optionally refresh the preset first, and set a delivery destination.
 *
 * @example
 * const body: ReencodeRequest = { refreshPreset: true };
 */
export type ReencodeRequest = z.input<typeof ReencodeRequestSchema>;

/**
 * Body of `assets.postProcess`: transcription and scene detection to run on an existing asset.
 *
 * @example
 * const body: AssetPostProcessRequest = { postProcess: { transcribe: { translations: ["de"] } } };
 */
export type AssetPostProcessRequest = z.input<typeof AssetPostProcessRequestSchema>;

/**
 * Body of `uploads.completeMultipart`, optionally with encode options.
 *
 * @example
 * const body: MultipartCompleteRequest = { uploadKey, parts: [{ partNumber: 1, etag: '"abc"' }] };
 */
export type MultipartCompleteRequest = z.input<typeof MultipartCompleteRequestSchema>;

/**
 * Body of `admin.accounts.create`: slug, name, source buckets, features and an optional destination.
 *
 * @example
 * const account: CreateAccountRequest = { slug: "bella", name: "Bella", callbackUrl: "https://bella.example/hook" };
 */
export type CreateAccountRequest = z.input<typeof CreateAccountRequestSchema>;

/**
 * Body of `admin.accounts.update`: name, source buckets, features or the default destination.
 *
 * @example
 * const update: UpdateAccountRequest = { sourceBuckets: ["bella-sources"] };
 */
export type UpdateAccountRequest = z.input<typeof UpdateAccountRequestSchema>;

export type {
	AccountCreated,
	AccountDestinationResponse,
	AccountFeatures,
	AccountListResponse,
	AccountView,
	ActiveStill,
	ActiveStillResponse,
	AdminUsageAccount,
	AdminUsageResponse,
	ApiKeyCreated,
	AssetDeletedResponse,
	AssetListQuery,
	AssetListResponse,
	AssetOutputView,
	AssetScenesResponse,
	AssetTranscriptsResponse,
	AssetView,
	CallbackAttempt,
	CallbackDeliveryListResponse,
	CallbackDeliveryView,
	ClonePresetRequest,
	CreateApiKeyRequest,
	CreatePresetRequest,
	Destination,
	DestinationTestError,
	DestinationTestRequest,
	DestinationTestResult,
	DryRunRequest,
	DryRunResponse,
	EncodingProfile,
	EventBridgePolicyResponse,
	EncodeSource,
	ExpectedVersionQuery,
	FileUploadRequest,
	FileUploadResponse,
	HealthResponse,
	ItemKind,
	ItemStatus,
	MediaAssetOutput,
	MultipartCreateRequest,
	MultipartCreateResponse,
	MultipartCompleteResponse,
	MultipartListPartsResponse,
	MultipartSignPartsResponse,
	PlannedItem,
	PostProcessDefaults,
	PostProcessRequest,
	PostProcessStatus,
	PresignedUploadRequest,
	PresignedUploadResponse,
	PresetListResponse,
	PresetScope,
	PresetView,
	ProfileInput,
	ProfilePatch,
	ReadyResponse,
	RedeliverResponse,
	RequestError,
	RequestItemView,
	RequestMode,
	RequestProgress,
	RequestStatus,
	RequestView,
	ResourceUnits,
	RotateWebhookSecretResponse,
	SceneAnalysisView,
	SceneView,
	SourceMetadata,
	TranscriptFiles,
	TranscriptView,
	UpdatePresetRequest,
	UpdateProfileRequest,
	UsageDay,
	UsageQuery,
	UsageResponse,
	WebhookEvent,
	WebhookEventName
} from "@helios/contracts";
