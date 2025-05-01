import type http from "node:http";
import type { Static, TSchema } from "@alepha/core";
import { $hook, $inject, $logger, Alepha, t } from "@alepha/core";
import fastifyHttpProxy from "@fastify/http-proxy";
import { ajvFilePlugin } from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import ajvFormats from "ajv-formats";
import type {
	FastifyHttpOptions,
	FastifyInstance,
	FastifyPluginCallback,
	FastifyPluginOptions,
	FastifyRegisterOptions,
	FastifyReply,
	FastifyRequest,
	RouteOptions,
} from "fastify";
import fastify from "fastify";
import type { FastifySchema } from "fastify/types/schema";
import type { ProxyDescriptorOptions } from "../../descriptors/$proxy";
import type {
	RouteDescriptorOptions,
	RouteMethod,
} from "../../descriptors/$route";
import type { ServeDescriptorOptions } from "../../descriptors/$serve";
import { HttpError } from "../../errors/HttpError";
import { ValidationError } from "../../errors/ValidationError";
import { HeaderManager, type Headers } from "../../helpers/HeaderManager.ts";
import { type RouteObject, ServerProvider } from "../ServerProvider";

const envSchema = t.object({
	/**
	 * The port on which the server should listen.
	 */
	SERVER_PORT: t.uint({ default: 3000 }),

	/**
	 * The host on which the server should listen.
	 */
	SERVER_HOST: t.string({ default: "localhost" }),

	/**
	 * The validator to use for the server.
	 *
	 * @default "typebox"
	 */
	SERVER_FASTIFY_VALIDATOR: t.enum(["typebox", "ajv"], {
		default: "typebox",
	}),
});

declare module "../../descriptors/$route" {
	interface RouteDescriptorOptions<TConfig extends RequestConfig> {
		fastify?: Partial<Omit<RouteOptions, "url" | "method" | "handler">>;
	}

	interface RouteContext {
		fastify?: { req: FastifyRequest; res: FastifyReply };
	}
}

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
	interface Hooks {
		"configure:fastify": FastifyInstance;
		"fastify:onRoute": RouteOptions;
	}
}

/**
 * Fastify Provider.
 */
export class FastifyServerProvider extends ServerProvider {
	protected readonly log = $logger();
	protected readonly env = $inject(envSchema);
	protected readonly alepha = $inject(Alepha);
	public readonly app = this.createServer();

	protected readonly configure = $hook({
		name: "configure",
		handler: async () => {
			await this.alepha.run("configure:fastify", this.app);

			if (this.alepha.isServerless()) {
				this.alepha.handle = async (req, res) => {
					this.app.server.emit("request", req, res);
				};
			}
		},
	});

	protected readonly start = $hook({
		name: "start",
		handler: async () => {
			await this.listen();
		},
	});

	protected readonly stop = $hook({
		name: "stop",
		handler: async () => {
			this.log.debug("Close server ...");
			if (this.alepha.isProduction()) {
				await this.app.close(); // wait for all requests to finish in production
			} else {
				this.app.close().catch(); // close immediately in development
			}
			this.log.info("Close OK");
		},
	});

	protected createServer() {
		const app = fastify(this.options());

		app.addHook("onRequest", async () => {
			if (!this.alepha.isReady()) {
				throw new HttpError(
					503,
					"ERR_NOT_READY",
					"The server is not ready yet.",
				);
			}
		});

		app.addHook("onRoute", (args) =>
			this.alepha.run("fastify:onRoute", args, { log: false }),
		);

		if (this.env.SERVER_FASTIFY_VALIDATOR.startsWith("typebox")) {
			this.useTypeboxValidator(app);
		}

		return app;
	}

	/**
	 * Serve static files from the specified directory.
	 *
	 * @param opts - The options for serving static files.
	 */
	public async serve(opts: ServeDescriptorOptions) {
		const prefix = opts.prefix || "/";

		this.log.info(`Serve '${prefix}' -> '${opts.root}'`);

		await this.register(fastifyStatic, {
			...opts,
			prefix,
		});
	}

	/**
	 * Proxy the specified URL to the target URL.
	 *
	 * @param opts - The options for the proxy.
	 */
	public async proxy(opts: ProxyDescriptorOptions) {
		const prefix = opts.prefix ?? "/";

		this.log.debug(`+ Proxy '${prefix}' -> '${opts.upstream}'`);

		await this.register(fastifyHttpProxy, {
			...opts,
			prefix,
		});
	}

	/**
	 * Registers a plugin with the specified options.
	 *
	 * @param plugin - The plugin to be registered.
	 * @param options - The options to be passed to the plugin during registration.
	 * @return A promise that resolves when the plugin has been registered.
	 */
	public async register<Options extends FastifyPluginOptions>(
		plugin: FastifyPluginCallback<Options>,
		options: FastifyRegisterOptions<Options>,
	): Promise<void> {
		await this.app.register(plugin, options);
	}

	/**
	 * Returns the hostname of the server.
	 */
	public get hostname(): string {
		const address = this.app.server?.address();
		if (address && typeof address === "object") {
			return `http://${this.env.SERVER_HOST}:${address.port}`;
		}

		return `http://${this.env.SERVER_HOST}:${this.env.SERVER_PORT}`;
	}

	/**
	 * Use the Typebox validator for the server.
	 *
	 * @protected
	 */
	protected useTypeboxValidator(app: FastifyInstance) {
		app.setValidatorCompiler<TSchema>(({ schema, httpPart }) => {
			return (value) => {
				try {
					return {
						value: this.alepha.parse(schema, value, {
							clone: false,
							convert: httpPart !== "body",
						}),
					};
				} catch (error) {
					return {
						error: new ValidationError(
							`Invalid ${httpPart} payload - ${error instanceof Error ? error.message : "Unknown error"}`,
						),
					};
				}
			};
		});
	}

	/**
	 * Returns the options for the Fastify server.
	 */
	public options(): FastifyHttpOptions<http.Server> {
		return {
			logger: false,
			ajv: {
				customOptions: this.getAjvOptions(),
				plugins: this.getAjvPlugins(),
			},
		};
	}

	/**
	 * Override this method to add custom options to the Ajv instance.
	 *
	 * @protected
	 */
	protected getAjvOptions(): any {
		return {};
	}

	/**
	 * Override this method to add custom plugins to the Ajv instance.
	 *
	 * @protected
	 */
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	protected getAjvPlugins(): (Function | [Function, unknown])[] {
		return [
			ajvFilePlugin,
			ajvFormats, // add JsonSchema format: "email", "uuid", ...
		];
	}

	/**
	 * Listens for incoming requests on the server.
	 */
	protected async listen() {
		if (this.alepha.isServerless()) {
			await this.app.ready();
			return;
		}

		let port = this.env.SERVER_PORT;
		if (this.alepha.isTest() && port === 3000) {
			port = 0;
		}

		await this.app.listen({
			port,
			host: this.env.SERVER_HOST,
		});
	}

	/**
	 * Registers a route with the Fastify server.
	 *
	 * @param options
	 * @param route
	 */
	public async route(route: RouteObject, options: RouteDescriptorOptions = {}) {
		const handler = async (req: FastifyRequest, res: FastifyReply) => {
			const url = new URL(`${req.protocol}://${req.host}${req.url}`);
			const headers = new HeaderManager(req.headers as Headers);
			const response = await this.run(
				route,
				{
					url,
					body: req.body,
					params: { ...(req.params ?? {}) },
					query: { ...(req.query ?? {}) },
					headers,
				},
				{
					fastify: { req, res },
				},
			);

			res.headers(headers.toResponse());

			return response;
		};

		if (route.url === "/*" || route.url === "*") {
			this.app.setNotFoundHandler(handler);
			return;
		}

		this.app.route({
			...options.fastify,
			...route,
			method: route.method ?? "GET",
			handler,
		});
	}
}

export interface HttpRouteDefinition {
	url: string;
	method: RouteMethod;
	schema: FastifySchema;
}
