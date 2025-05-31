import { $inject, Alepha, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $route } from "../../descriptors/$route.ts";

/**
 * Register `/health` endpoint.
 *
 * - Provides basic health information about the server.
 */
export class ServerHealthProvider {
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly alepha = $inject(Alepha);

	public readonly health = $route({
		path: "/health",
		schema: {
			response: t.object({
				message: t.string(),
				uptime: t.number(),
				date: t.datetime(),
				ready: t.boolean(),
			}),
		},
		silent: true,
		handler: () => ({
			message: "OK",
			uptime: Math.floor(process.uptime()),
			date: this.dateTimeProvider.nowISOString(),
			ready: this.alepha.isReady(),
		}),
	});
}
