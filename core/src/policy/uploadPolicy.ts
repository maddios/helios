import { UnprocessableError, ValidationError, type UploadPolicy } from "@helios/contracts";
import { config } from "../config";
import type { Account } from "../models";
import { isInlineType, matchesPattern, typeMatches } from "./contentTypes";

export function defaultUploadPolicy(): UploadPolicy {
	return { allowedContentTypes: ["*/*"], maxBytes: config().MAX_UPLOAD_BYTES };
}

export function effectiveUploadPolicy(account: Pick<Account, "uploadPolicy">): UploadPolicy {
	return account.uploadPolicy ?? defaultUploadPolicy();
}

export function assertUploadPolicy(policy: UploadPolicy): void {
	const { MAX_UPLOAD_BYTES } = config();
	if (policy.maxBytes > MAX_UPLOAD_BYTES) {
		throw new ValidationError(`Upload policy maxBytes exceeds the ${MAX_UPLOAD_BYTES}-byte limit`, {
			maxBytes: policy.maxBytes,
			MAX_UPLOAD_BYTES
		});
	}
}

export function resolveUploadPolicy(account: Account, requested: UploadPolicy | undefined): UploadPolicy {
	const base = effectiveUploadPolicy(account);
	if (requested === undefined) {
		return base;
	}
	const widened = requested.allowedContentTypes.filter(
		(pattern) => !base.allowedContentTypes.some((allowed) => matchesPattern(allowed, pattern))
	);
	if (widened.length > 0) {
		throw new ValidationError(
			`Upload policy cannot widen the account policy: ${widened.join(", ")} is not allowed`,
			{ widened },
			"policy_widened"
		);
	}
	if (requested.maxBytes > base.maxBytes) {
		throw new ValidationError(
			`Upload policy cannot widen the account policy: maxBytes ${requested.maxBytes} exceeds ${base.maxBytes}`,
			{ maxBytes: requested.maxBytes, accountMaxBytes: base.maxBytes },
			"policy_widened"
		);
	}
	return requested;
}

/** Facts about a file: every content type its bytes could be (or the declared type) and its size. */
export interface UploadFacts {
	candidates: readonly string[];
	sizeBytes: number;
}

export interface StoredFacts {
	declaredContentType?: string;
	declaredSizeBytes?: number;
	filename: string;
	candidates: readonly string[];
	sizeBytes: number;
}

export function contentTypeViolationOf(policy: UploadPolicy, candidates: readonly string[]): string | undefined {
	const allowed = candidates.some((candidate) =>
		policy.allowedContentTypes.some((pattern) => matchesPattern(pattern, candidate))
	);
	return allowed ? undefined : `Content type ${candidates[0] ?? "unknown"} is not allowed by the upload policy`;
}

export function violationOf(policy: UploadPolicy, facts: UploadFacts): string | undefined {
	const typeReason = contentTypeViolationOf(policy, facts.candidates);
	if (typeReason !== undefined) {
		return typeReason;
	}
	if (facts.sizeBytes > policy.maxBytes) {
		return `File is larger than the ${policy.maxBytes}-byte limit of the upload policy`;
	}
	return undefined;
}

/**
 * Checked on the stored bytes. A declared inline type (image, video, audio, PDF) must be what the bytes are,
 * because the CDN serves it inline under that type.
 */
export function storedViolationOf(policy: UploadPolicy, facts: StoredFacts): string | undefined {
	const { declaredContentType, declaredSizeBytes, filename, candidates, sizeBytes } = facts;
	if (declaredSizeBytes !== undefined && declaredSizeBytes !== sizeBytes) {
		return `Stored size ${sizeBytes} does not match the declared size ${declaredSizeBytes}`;
	}
	if (
		declaredContentType !== undefined &&
		isInlineType(declaredContentType) &&
		!typeMatches(declaredContentType, candidates, filename)
	) {
		return `Declared content type ${declaredContentType} does not match the content (${candidates[0] ?? "unknown"})`;
	}
	return violationOf(policy, { candidates, sizeBytes });
}

export function assertWithinPolicy(policy: UploadPolicy, facts: UploadFacts): void {
	const reason = violationOf(policy, facts);
	if (reason !== undefined) {
		throw new UnprocessableError(reason, undefined, "policy_violation");
	}
}
