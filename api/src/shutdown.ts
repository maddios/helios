import type { Server } from "node:http";

export function closeServer(server: Server, drainMs: number): Promise<void> {
	return new Promise((resolve) => {
		const force = setTimeout(() => server.closeAllConnections(), drainMs);
		server.close(() => {
			clearTimeout(force);
			resolve();
		});
		server.closeIdleConnections();
	});
}
