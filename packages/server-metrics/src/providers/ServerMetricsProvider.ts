import { $hook, $inject, Alepha, type HookDescriptor } from "@alepha/core";
import { $route, type RouteDescriptor } from "@alepha/server";
import { collectDefaultMetrics, Registry } from "prom-client";

export class ServerMetricsProvider {
	protected readonly register: Registry = new Registry();
	protected readonly alepha: Alepha = $inject(Alepha);

	public options: {
		prefix?: string;
		gcDurationBuckets?: number[];
		eventLoopMonitoringPrecision?: number;
		labels?: object;
	} = {};

	public readonly metrics: RouteDescriptor = $route({
		method: "GET",
		path: "/metrics",
		silent: true,
		handler: () => this.register.metrics(),
	});

	protected readonly onStart: HookDescriptor<"start"> = $hook({
		name: "start",
		handler: () => {
			collectDefaultMetrics({
				register: this.register,
				...this.options,
			});
		},
	});
}
