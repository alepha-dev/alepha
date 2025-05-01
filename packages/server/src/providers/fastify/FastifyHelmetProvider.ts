import { $hook } from "@alepha/core";
import type { FastifyHelmetOptions } from "@fastify/helmet";
import { fastifyHelmet } from "@fastify/helmet";

export type FastifyHelmetProviderOptions = FastifyHelmetOptions;

export class FastifyHelmetProvider {
	protected readonly configure = $hook({
		name: "configure:fastify",
		handler: async (app) => {
			await app.register(fastifyHelmet, this.options());
		},
	});

	public options(
		override: FastifyHelmetProviderOptions = {},
	): FastifyHelmetProviderOptions {
		return {
			contentSecurityPolicy: false, // too painful for now, need knowledge to use it properly
			crossOriginOpenerPolicy: false, // not compatible with swagger ui login,
			...override,
		};
	}
}
