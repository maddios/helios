import type { ChatContentPart } from "@helios/core";
import {
	imageUserContent,
	SCENES_PROMPT_VERSION,
	singleWindowSystemPrompt,
	summarySystemPrompt,
	summaryUserContent,
	windowedSystemPrompt,
	windowUserContent,
	type WindowPrompt
} from "../../../src/ai/prompts/scenes/v1";

const STILL_URL = "data:image/jpeg;base64,AAAA";

function windowPrompt(overrides: Partial<WindowPrompt> = {}): WindowPrompt {
	return {
		durationSec: 12,
		startSec: 0,
		endSec: 6,
		stills: [
			{ index: 4, timestampSec: 0, imageUrl: STILL_URL },
			{ index: 5, timestampSec: 3, imageUrl: "https://cdn.test/still-5.jpg" }
		],
		allowedTimes: [0, 0.5, 3],
		transcript: { language: "en", lines: [{ start: 0.5, end: 2, text: "hello there" }] },
		previous: null,
		...overrides
	};
}

function textOf(parts: ChatContentPart[]): string {
	return parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

describe("scenes prompt v1", () => {
	it("is versioned", () => {
		expect(SCENES_PROMPT_VERSION).toBe("scenes-v2");
	});

	it("builds the window user message with duration, window, allowed times and transcript lines", () => {
		const parts = windowUserContent(windowPrompt());
		const header = textOf(parts);

		expect(header).toContain("Video duration: 12 s. Window: 0-6 s.");
		expect(header).toContain("Allowed start times (s): 0, 0.5, 3");
		expect(header).toContain("Transcript (language: en):\n[0.5-2] hello there");
	});

	it("labels every still with its global index and exact time, then its image at low detail", () => {
		const parts = windowUserContent(windowPrompt());
		const stillParts = parts.slice(1);

		expect(stillParts).toEqual([
			{ type: "text", text: "Still 4 at 0s" },
			{ type: "image_url", image_url: { url: STILL_URL, detail: "low" } },
			{ type: "text", text: "Still 5 at 3s" },
			{ type: "image_url", image_url: { url: "https://cdn.test/still-5.jpg", detail: "low" } }
		]);
	});

	it("states that no transcript exists when there is none", () => {
		const header = textOf(windowUserContent(windowPrompt({ transcript: null })));

		expect(header).toContain("No transcript is available for this video.");
		expect(header).not.toContain("Transcript (language");
	});

	it("describes the previous window's last scene when the window is a continuation", () => {
		const header = textOf(
			windowUserContent(windowPrompt({ previous: { description: "a kitchen with a blender", setting: "kitchen" } }))
		);

		expect(header).toContain("Previous window's last scene (setting: kitchen): a kitchen with a blender");
	});

	it("adds beauty-oriented people rules only when people attributes are enabled", () => {
		expect(singleWindowSystemPrompt(true)).toContain("beauty, skincare and haircare product relevance");
		expect(windowedSystemPrompt(true)).toContain("List at most 10 people");
		expect(windowedSystemPrompt(false)).not.toContain("People:");
		expect(summarySystemPrompt()).not.toContain("People:");
	});

	it("asks the single-window prompt for a summary and the windowed prompt for scenes only", () => {
		expect(singleWindowSystemPrompt(false)).toContain("Then describe the whole video in the summary.");
		expect(windowedSystemPrompt(false)).toContain("the video summary is written separately");
	});

	it("states that continuesPrevious is false when no previous scene is given", () => {
		expect(windowedSystemPrompt(false)).toContain("When no previous scene is given, continuesPrevious is false.");
		expect(singleWindowSystemPrompt(false)).toContain("set continuesPrevious to false");
	});

	it("collapses newlines in transcript text", () => {
		const header = textOf(
			windowUserContent(
				windowPrompt({ transcript: { language: "en", lines: [{ start: 0.5, end: 2, text: "one\ntwo\n\nthree" }] } })
			)
		);

		expect(header).toContain("[0.5-2] one two three");
	});

	it("lists the scenes of the summary request as text", () => {
		const text = summaryUserContent(12, [
			{
				startSec: 0,
				endSec: 6,
				setting: "kitchen",
				description: "a blender",
				products: [{ type: "brand", name: "Acme" }]
			},
			{ startSec: 6, endSec: 12, setting: "street", description: "a bike", products: [] }
		]);

		expect(text).toBe(
			[
				"Video duration: 12 s.",
				"Scenes:",
				"1. [0-6] setting: kitchen; a blender; products: brand Acme",
				"2. [6-12] setting: street; a bike"
			].join("\n")
		);
	});

	it("builds the image user message as one image at low detail", () => {
		expect(imageUserContent(STILL_URL)).toEqual([
			{ type: "text", text: "The image follows." },
			{ type: "image_url", image_url: { url: STILL_URL, detail: "low" } }
		]);
	});
});
