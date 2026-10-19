export const IMAGE_FORMATS = ["jpg", "png", "webp", "avif"] as const;
export const CROP_MODES = ["pad", "fit", "fill", "limit"] as const;
export const GRAVITIES = [
	"center",
	"north",
	"south",
	"east",
	"west",
	"northeast",
	"northwest",
	"southeast",
	"southwest"
] as const;

export type ImageFormat = (typeof IMAGE_FORMATS)[number];
export type CropMode = (typeof CROP_MODES)[number];
export type Gravity = (typeof GRAVITIES)[number];

export interface ImageTransform {
	w?: number;
	h?: number;
	c?: CropMode;
	g?: Gravity;
	b?: string;
	q?: number;
	f?: ImageFormat;
}
