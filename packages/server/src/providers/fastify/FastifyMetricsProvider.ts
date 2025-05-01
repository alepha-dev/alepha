import type { Static } from "@alepha/core";
import { $hook, $inject, t } from "@alepha/core";
import fastifyMetrics from "fastify-metrics";
import type { IMetricsPluginOptions } from "fastify-metrics/dist/types";

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export type FastifyMetricsProviderOptions = Partial<IMetricsPluginOptions>;

const envSchema = t.object({
	SERVER_METRICS_PREFIX: t.string({ default: "/metrics" }),
});

export class FastifyMetricsProvider {
	protected readonly env = $inject(envSchema);

	protected readonly configure = $hook({
		name: "configure:fastify",
		handler: async (app) => {
			await app.register(fastifyMetrics, this.options());
		},
	});

	/**
	 * Override this method to provide custom options for the FastifyMetrics plugin.
	 */
	public options(
		override: FastifyMetricsProviderOptions = {},
	): FastifyMetricsProviderOptions {
		return {
			clearRegisterOnInit: true,
			endpoint: this.env.SERVER_METRICS_PREFIX,
			...override,
		};
	}
}
