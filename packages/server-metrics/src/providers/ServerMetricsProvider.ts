import {$hook, $inject, Alepha, HookDescriptor} from "@alepha/core";
import type {ActionDescriptor} from "@alepha/server";
import {$action} from "@alepha/server";
import {collectDefaultMetrics, Registry} from "prom-client";

export class ServerMetricsProvider {
	protected readonly register: Registry = new Registry();
	protected readonly alepha: Alepha = $inject(Alepha);

	public options: {
		prefix?: string;
		gcDurationBuckets?: number[];
		eventLoopMonitoringPrecision?: number;
		labels?: object;
	} = {}

	public readonly metrics: ActionDescriptor = $action({
		method: "GET",
		path: "/metrics",
		silent: true,
		internal: true,
		security: false,
		handler: () => this.register.metrics(),
	});

	protected readonly onStart: HookDescriptor<"start"> = $hook({
		name: "start",
		handler: () => {
			collectDefaultMetrics({
				register: this.register,
				...this.options
			});
		}
	})
}
