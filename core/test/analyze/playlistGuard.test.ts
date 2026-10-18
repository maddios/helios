import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { probeSource, resetAnalyzeConfigForTests } from "../../src/analyze";
import { UnprocessableSourceError } from "../../src/ssrf";

const HLS_PLAYLIST = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXTINF:1.0,", "file:///etc/hostname", "#EXT-X-ENDLIST", ""].join(
	"\n"
);
const CONCAT_LIST = "ffconcat version 1.0\nfile 'file:///etc/hostname'\n";

describe("probeSource with a playlist that points at a local file", () => {
	const original = process.env;
	let server: Server;
	let base: string;

	beforeAll(async () => {
		process.env = {
			...original,
			FFPROBE_PATH: "ffprobe",
			ANALYZE_TIMEOUT_SEC: "30",
			SOURCE_URL_TTL_SEC: "3600",
			MAX_INGEST_BYTES: "524288000"
		};
		resetAnalyzeConfigForTests();
		server = createServer((req, res) => {
			res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
			res.end(req.url === "/concat.txt" ? CONCAT_LIST : HLS_PLAYLIST);
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		server.closeAllConnections();
		await new Promise<void>((done) => server.close(() => done()));
		process.env = original;
		resetAnalyzeConfigForTests();
	});

	it.each(["/playlist.m3u8", "/concat.txt"])("rejects %s without reading the local file", async (path) => {
		await expect(probeSource(`${base}${path}`)).rejects.toThrow(UnprocessableSourceError);
	});
});
