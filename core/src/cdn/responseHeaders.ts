/**
 * Headers every CDN response carries. `infra/cdn.yml` sets the same values on its ResponseHeadersPolicy, and the local
 * image edge sends them too; a template test keeps the two in step.
 */
export const EDGE_RESPONSE_HEADERS = {
	"X-Content-Type-Options": "nosniff",
	"Content-Security-Policy":
		"default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
	"Cross-Origin-Resource-Policy": "cross-origin"
} as const;
