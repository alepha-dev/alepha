import { $inject, Alepha } from "@alepha/core";
import type { ActionDescriptor } from "@alepha/server";
import { $action } from "@alepha/server";
import { collectDefaultMetrics, Registry } from "prom-client";

export class ServerMetricsProvider {
	protected readonly register: Registry;
	protected readonly alepha: Alepha = $inject(Alepha);

	public readonly metrics: ActionDescriptor = $action({
		method: "GET",
		path: "/metrics",
		silent: true,
		internal: true,
		security: false,
		handler: () => this.register.metrics(),
	});

	constructor() {
		this.register = new Registry();
		collectDefaultMetrics({
			register: this.register,
			prefix: `${(this.alepha.env.APP_NAME ?? "app").toLowerCase()}_`,
		});
	}
}
