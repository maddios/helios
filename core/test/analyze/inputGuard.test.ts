import { config, resetConfigForTests } from "../../src/config";
import { mediaInputGuardArgs } from "../../src/analyze";

const DEMUXERS =
	"mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts,flv,mpeg,ogg,wav,mp3,aac,flac,image2,png_pipe,jpeg_pipe,webp_pipe,gif";

describe("mediaInputGuardArgs", () => {
	const original = process.env;

	afterEach(() => {
		process.env = original;
		resetConfigForTests();
	});

	it("allows https, tls and tcp, plus http in the local stage", () => {
		expect(config().STAGE).toBe("local");
		expect(mediaInputGuardArgs()).toEqual(["-protocol_whitelist", "https,tls,tcp,http", "-format_whitelist", DEMUXERS]);
	});

	it("drops http outside the local stage", () => {
		process.env = { ...original, STAGE: "prod", SSRF_ALLOWED_HOSTS: "" };
		resetConfigForTests();
		expect(mediaInputGuardArgs()).toEqual(["-protocol_whitelist", "https,tls,tcp", "-format_whitelist", DEMUXERS]);
	});

	it("never allows playlist, concat or file demuxers", () => {
		const formats = mediaInputGuardArgs()[3]?.split(",") ?? [];
		for (const demuxer of ["hls", "concat", "image2pipe", "data"]) {
			expect(formats).not.toContain(demuxer);
		}
	});
});
