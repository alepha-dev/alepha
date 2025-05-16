import { $inject, Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $action } from "../../descriptors/$action.ts";
import { healthSchema } from "../../schemas/healthSchema.ts";

export class ServerHealthProvider {
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly alepha = $inject(Alepha);

	public readonly health = $action({
		path: "/health",
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
