import { $inject, Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $action } from "../../descriptors/$action.ts";
import { healthSchema } from "../../schemas/healthSchema.ts";

/**
 * Register `/health` endpoint.
 *
 * - Provides basic health information about the server.
 */
export class ServerHealthProvider {
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly alepha = $inject(Alepha);

	public readonly health = $action({
		base: "/",
		path: "/health",
		group: "system",
		//silent: true,
		internal: true,
		security: false,
		schema: {
			response: healthSchema,
		},
		handler: () => ({
			message: "OK",
			uptime: Math.floor(process.uptime()),
			date: this.dateTimeProvider.nowISOString(),
			ready: this.alepha.isReady(),
		}),
	});
}
