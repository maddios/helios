import { contentDispositionFor, storedViolationOf, typeMatches } from "../../src/policy";
import { sniffHead } from "../../src/files/sniff";

const MB = 1024 * 1024;
const POLICY = { allowedContentTypes: ["*/*"], maxBytes: 10 * MB };
const hex = (value: string) => Buffer.from(value.replace(/\s+/g, ""), "hex");
const ascii = (value: string) => Buffer.from(value, "ascii");

const WEBM = hex("1A45DFA3 9F 4286 81 01 42F7 81 01 42F2 81 04 42F3 81 08 4282 84 7765626D 4287 81 04 4285 81 02");
const HEIF = hex("00000018 66747970 68656963 00000000 6D696631 68656963");
const WAV = Buffer.concat([ascii("RIFF"), hex("24000000"), ascii("WAVEfmt ")]);
const M4A = hex("00000020 66747970 4D344120 00000000 4D344120 6D703432");
const ZIP_OOXML = Buffer.concat([hex("504B0304 14000600"), ascii("[Content_Types].xml"), ascii("word/document.xml")]);
const ZIP_PLAIN = Buffer.concat([hex("504B0304 14000600"), ascii("notes.txt")]);
const SVG = ascii('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = ascii("<!DOCTYPE html><html><body><script>alert(1)</script></body></html>");
const PNG = hex("89504E470D0A1A0A0000000D49484452");

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("typeMatches with real header samples", () => {
	it.each([
		["video/webm", WEBM, "clip.webm", true],
		["video/x-matroska", WEBM, "clip.mkv", true],
		["video/mp4", WEBM, "clip.mp4", false],
		["image/heic", HEIF, "photo.heic", true],
		["image/heif", HEIF, "photo.heif", true],
		["image/png", HEIF, "photo.png", false],
		["audio/wav", WAV, "sound.wav", true],
		["audio/x-wav", WAV, "sound.wav", true],
		["audio/wave", WAV, "sound.wav", true],
		["audio/mpeg", WAV, "sound.mp3", false],
		["audio/mp4", M4A, "song.m4a", true],
		["audio/mp4", M4A, "song.mp4", false],
		["video/mp4", M4A, "song.m4a", true],
		[DOCX, ZIP_OOXML, "report.docx", true],
		[DOCX, ZIP_PLAIN, "report.docx", true],
		[DOCX, ZIP_PLAIN, "report.zip", false],
		[XLSX, ZIP_PLAIN, "sheet.xlsx", true],
		[XLSX, ZIP_PLAIN, "sheet.docx", false],
		["image/svg+xml", SVG, "logo.svg", true],
		["image/png", SVG, "logo.png", false],
		["text/html", HTML, "page.html", true],
		["image/png", HTML, "page.png", false]
	])("declared %s for %s (%s) matches: %s", (declared, bytes, filename, expected) => {
		expect(typeMatches(declared, sniffHead(bytes).candidates, filename)).toBe(expected);
	});
});

describe("sniffHead with real header samples", () => {
	it("reports every candidate type of a WebM container, primary first", () => {
		expect(sniffHead(WEBM).candidates).toEqual(expect.arrayContaining(["video/x-matroska", "audio/webm"]));
	});

	it("reports HTML and SVG, which the magic numbers of a text file do not name", () => {
		expect(sniffHead(HTML)).toMatchObject({ contentType: "text/html", candidates: ["text/html"] });
		expect(sniffHead(SVG).contentType).toBe("image/svg+xml");
	});
});

describe("contentDispositionFor", () => {
	it.each([
		["image/png", "inline"],
		["video/mp4", "inline"],
		["audio/wav", "inline"],
		["application/pdf", "inline"],
		["image/svg+xml", "attachment"],
		["text/html", "attachment"],
		["application/zip", "attachment"],
		[DOCX, "attachment"]
	])("serves %s as %s", (contentType, disposition) => {
		expect(contentDispositionFor(contentType)).toBe(disposition);
	});
});

describe("storedViolationOf for inline types", () => {
	it("rejects an SVG or an HTML document declared as an image, so it is never served inline as one", () => {
		expect(
			storedViolationOf(POLICY, {
				declaredContentType: "image/png",
				filename: "logo.png",
				candidates: sniffHead(SVG).candidates,
				sizeBytes: SVG.length
			})
		).toMatch(/does not match the content/);
		expect(
			storedViolationOf(POLICY, {
				declaredContentType: "image/png",
				filename: "page.png",
				candidates: sniffHead(HTML).candidates,
				sizeBytes: HTML.length
			})
		).toMatch(/does not match the content/);
	});

	it("accepts a declared PNG with PNG bytes", () => {
		expect(
			storedViolationOf(POLICY, {
				declaredContentType: "image/png",
				filename: "a.png",
				candidates: sniffHead(PNG).candidates,
				sizeBytes: PNG.length
			})
		).toBeUndefined();
	});
});
