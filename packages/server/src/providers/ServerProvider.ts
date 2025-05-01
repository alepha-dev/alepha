import { randomUUID } from "node:crypto";
import { $inject, $logger, Alepha, NotImplementedError } from "@alepha/core";
import type { ProxyDescriptorOptions } from "../descriptors/$proxy";
import type {
	RouteContext,
	RouteDescriptorOptions,
	RouteHandler,
	RouteHandlerArgs,
	RouteMethod,
} from "../descriptors/$route";
import type { ServeDescriptorOptions } from "../descriptors/$serve";
import { HttpError } from "../errors/HttpError.ts";

export class ServerProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);

	/**
	 * Registers a route with the Fastify server.
	 *
	 * @param route
	 * @param options
	 */
	public async route(
		route: RouteObject,
		options: RouteDescriptorOptions = {},
	): Promise<void> {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Serve static files from the specified directory.
	 *
	 * @param opts - The options for serving static files.
	 */
	public async serve(opts: ServeDescriptorOptions) {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Proxy the specified URL to the target URL.
	 *
	 * @param opts - The options for the proxy.
	 */
	public async proxy(opts: ProxyDescriptorOptions) {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Returns the hostname of the server.
	 */
	public get hostname(): string {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Creates a route handler for the specified route.
	 *
	 * @param route
	 * @param request
	 * @param context
	 * @protected
	 */
	protected async run(
		route: RouteObject,
		request: Partial<RouteHandlerArgs>,
		context: RouteContext,
	) {
		const requestId = context.fastify?.req.id ?? randomUUID();
		const skipLog = route.silent ?? false;

		const result = await this.alepha.als.run(
			{ request, context: requestId },
			async () => {
				if (!skipLog) {
					this.log.info("Incoming request");
				}
				const now = Date.now();

				// <-- ---> parse request with typebox here

				await this.alepha.run("server:onRequest", {
					request,
					context,
					route,
				});

				let status = 200;
				try {
					const result = await route.handler(
						request as RouteHandlerArgs,
						context,
					);

					if (result instanceof Response) {
						status = result.status;
					}

					return result;
				} catch (error) {
					if (!skipLog) {
						status = 500;
						if (error instanceof HttpError && error.statusCode) {
							status = error.statusCode;
						}

						this.log.error("Request has failed", error as Error);
					}

					throw error; // let Fastify handle error for now
				} finally {
					const ms = Date.now() - now;

					await this.alepha.run("server:onSend", {
						request,
						context,
						route,
						status,
						ms,
					});

					if (!skipLog) {
						this.log.info("Request completed", {
							ms,
							status,
						});
					}
				}
			},
		);

		if (!result) {
			return new Response(null, { status: 204 });
		}

		return result;
	}
}

export interface RouteObject {
	method: RouteMethod;
	url: string;
	handler: RouteHandler;
	schema?: any; // Fastify schema
	silent?: boolean;
}

export interface HttpConfig {
	params?: any;
	body?: any;
	query?: any;
}
