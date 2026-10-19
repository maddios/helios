import type { LlmUsage } from "@helios/contracts";

export interface MeteredUsage {
	audioSec?: number;
	llm?: LlmUsage[];
}

export class UsageMeter {
	private audioSec: number | undefined;
	private readonly llm: LlmUsage[] = [];

	recordAudio(seconds: number): void {
		this.audioSec = (this.audioSec ?? 0) + seconds;
	}

	recordLlm(call: LlmUsage): void {
		this.llm.push(call);
	}

	snapshot(): MeteredUsage {
		return {
			...(this.audioSec !== undefined && { audioSec: this.audioSec }),
			...(this.llm.length > 0 && { llm: [...this.llm] })
		};
	}
}
