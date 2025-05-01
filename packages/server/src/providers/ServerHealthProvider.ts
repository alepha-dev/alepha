import { $inject, Alepha, DateTimeProvider } from "@alepha/core";
import { $route } from "../descriptors/$route";
import { healthSchema } from "../schemas/healthSchema";

export class ServerHealthProvider {
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly alepha = $inject(Alepha);

	public readonly health = $route({
		url: "/health",
		group: "system",
		silent: true,
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
