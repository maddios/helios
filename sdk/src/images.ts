import {
	checkedCanonicalPath,
	ImageError,
	type CropMode,
	type Gravity,
	type ImageFormat,
	type ImageTransform as CanonicalTransform
} from "@helios/contracts";
import { ConfigurationError, ValidationError } from "./errors.js";

export type { CropMode, Gravity, ImageFormat };

/**
 * Transform of an image URL, using the same parameter names as the `/img/<params>/<key>` URL. `w` or `h` must be set.
 *
 * @example
 * const thumbnail: ImageTransform = { w: 320, h: 180, c: "fill", g: "center", q: 85, f: "webp" };
 * const letterbox: ImageTransform = { w: 640, h: 640, c: "pad", b: "000000" };
 */
export interface ImageTransform extends CanonicalTransform {
	/** Width in pixels, 1 to 4096. */
	w?: number;
	/** Height in pixels, 1 to 4096. */
	h?: number;
	/**
	 * Crop mode. `fit` (the default, omitted from the URL) fits inside the box; `fill` covers the box and crops using `g`;
	 * `limit` fits inside the box without enlarging; `pad` fits inside and fills the rest with `b`.
	 */
	c?: CropMode;
	/** Gravity for `c: "fill"`, e.g. `center` or `north`. Only valid with `fill`. */
	g?: Gravity;
	/**
	 * Padding colour as six lowercase hex digits, e.g. `ff0000`. Only valid with `c: "pad"`. Without it, JPG pads white
	 * and PNG/WebP/AVIF pad transparent.
	 */
	b?: string;
	/** Quality from 1 to 100. On PNG output it enables lossy palette quantization. */
	q?: number;
	/** Output format. Defaults to the source format (GIF/TIFF sources require an explicit format). */
	f?: ImageFormat;
}

/**
 * Builds canonical image URLs. The output matches the server's canonical form exactly, so the same image always has the
 * same URL and the CDN caches it once.
 *
 * Canonical form: parameters in the fixed order `w,h,c,g,b,q,f`, `c_fit` omitted, and an optional `?v=` cache-buster.
 * This class is pure: it makes no network call.
 *
 * @example
 * helios.images.url("acme/media/a1/still.jpg", { w: 320, f: "webp" }, 3);
 * // https://img.example.com/img/w_320,f_webp/acme/media/a1/still.jpg?v=3
 */
export class Images {
	private readonly baseUrl: string | undefined;

	/**
	 * @param baseUrl Origin that serves transformed images. Required for {@link url}.
	 * @internal
	 */
	constructor(baseUrl: string | undefined) {
		this.baseUrl = baseUrl?.replace(/\/+$/, "");
	}

	/**
	 * Builds the URL of a transformed image.
	 *
	 * @param key Storage key of a transformable object, e.g. `acme/media/a1/still.jpg`. Source and upload keys are rejected.
	 * @param transform Width, height, crop mode, gravity, padding colour, quality and format.
	 * @param version Optional cache-buster, appended as `?v=`.
	 * @returns The absolute image URL.
	 * @throws {ConfigurationError} When `imageBaseUrl` was not configured.
	 * @throws {ValidationError} When the key or the transform is invalid, with the server's error code (for example `missing_dimension`).
	 * @example
	 * const src = helios.images.url(asset.outputs.generic.items[0].key, { w: 640, h: 640, c: "pad", b: "000000" });
	 */
	url(key: string, transform: ImageTransform = {}, version?: number): string {
		if (this.baseUrl === undefined) {
			throw new ConfigurationError("configuration_error", "imageBaseUrl is required to build image URLs");
		}
		const url = `${this.baseUrl}${canonicalPath(key, transform)}`;
		return version === undefined ? url : `${url}?v=${version}`;
	}
}

function canonicalPath(key: string, transform: ImageTransform): string {
	try {
		return checkedCanonicalPath(key, transform);
	} catch (err) {
		if (err instanceof ImageError) {
			throw new ValidationError(err.code, err.message);
		}
		throw err;
	}
}
