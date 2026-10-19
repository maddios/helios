export const STYLES = `
:root {
	--bg: #f6f6f3;
	--fg: #1d1d1b;
	--muted: #66665f;
	--card: #ffffff;
	--border: #dcdcd4;
	--badge: #ecebe4;
	--good: #17703a;
	--bad: #b42318;
}
@media (prefers-color-scheme: dark) {
	:root:not([data-theme="light"]) {
		--bg: #141413;
		--fg: #ebebe6;
		--muted: #a0a097;
		--card: #1d1d1b;
		--border: #363633;
		--badge: #2a2a27;
		--good: #5fd08a;
		--bad: #ff8a80;
	}
}
:root[data-theme="dark"] {
	--bg: #141413;
	--fg: #ebebe6;
	--muted: #a0a097;
	--card: #1d1d1b;
	--border: #363633;
	--badge: #2a2a27;
	--good: #5fd08a;
	--bad: #ff8a80;
}
body {
	margin: 0;
	padding: 16px;
	background: var(--bg);
	color: var(--fg);
	font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
}
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 0 0 8px; }
h3 { font-size: 15px; margin: 0 0 8px; }
h4 { font-size: 12px; margin: 0 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.muted { color: var(--muted); font-weight: normal; }
section, .video {
	background: var(--card);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 12px 14px;
	margin: 12px 0;
}
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; vertical-align: top; padding: 6px; border-top: 1px solid var(--border); }
th { color: var(--muted); font-weight: 600; }
.kv th { width: 40%; }
.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 12px; }
.badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; }
.badge { background: var(--badge); border-radius: 999px; padding: 2px 8px; font-size: 12px; }
.badge.good { color: var(--good); }
.badge.bad { color: var(--bad); }
.error { color: var(--bad); }
.meta { color: var(--muted); font-size: 12px; margin-top: 4px; }
img.still { width: 160px; max-width: 100%; border-radius: 4px; display: block; }
`;
