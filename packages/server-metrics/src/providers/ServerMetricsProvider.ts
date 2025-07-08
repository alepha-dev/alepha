import { $hook, $inject, Alepha, type HookDescriptor } from "@alepha/core";
import { $route, type RouteDescriptor } from "@alepha/server";
import { collectDefaultMetrics, Registry } from "prom-client";

export interface ServerMetricsProviderOptions {
	prefix?: string;
	gcDurationBuckets?: number[];
	eventLoopMonitoringPrecision?: number;
	labels?: object;
}

export class ServerMetricsProvider {
	protected readonly register: Registry = new Registry();
	protected readonly alepha: Alepha = $inject(Alepha);

	public readonly options: ServerMetricsProviderOptions = {};

	public readonly metrics: RouteDescriptor = $route({
		method: "GET",
		path: "/metrics",
		silent: true,
		handler: () => this.register.metrics(),
	});

	protected readonly onStart: HookDescriptor<"start"> = $hook({
		on: "start",
		handler: () => {
			collectDefaultMetrics({
				register: this.register,
				...this.options,
			});
		},
	});
}
