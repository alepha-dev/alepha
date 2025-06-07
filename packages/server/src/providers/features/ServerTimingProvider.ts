import { $hook, $inject, Alepha } from "@alepha/core";

export class ServerTimingProvider {
	protected readonly alepha = $inject(Alepha);

	public readonly onRequest = $hook({
		priority: "first",
		name: "server:onRequest",
		handler: async ({ request }) => {
			const start = Date.now();
			request.metadata.timing = { start };
		},
	});

	public readonly onResponse = $hook({
		priority: "last",
		name: "server:onResponse",
		handler: async ({ request }) => {
			if (request.metadata.timing) {
				const { start } = request.metadata.timing;
				if (start) {
					const name = `${this.alepha.env.APP_NAME ?? "App"}Handler`;
					const duration = Date.now() - start;
					const timing = `${name};dur=${duration}`;
					if (request.reply.headers["Server-Timing"]) {
						request.reply.headers["Server-Timing"] += `, ${timing}`;
					} else {
						request.reply.headers["Server-Timing"] = timing;
					}
				}
			}
		},
	});
}
