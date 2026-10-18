export interface HeartbeatOptions {
	intervalSec: number;
	beat: () => Promise<void>;
	onError: (err: unknown) => void;
}

export function startHeartbeat({ intervalSec, beat, onError }: HeartbeatOptions): () => void {
	let timer: NodeJS.Timeout | undefined;
	let stopped = false;
	const schedule = () => {
		if (!stopped) {
			timer = setTimeout(tick, intervalSec * 1000);
		}
	};
	const tick = () => {
		beat().then(schedule, (err: unknown) => {
			onError(err);
			schedule();
		});
	};
	schedule();
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}
