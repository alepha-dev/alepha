import { $hook, $inject, Alepha, OPTIONS } from "@alepha/core";
import {
	type ServerHandler,
	type ServerRequest,
	ServerRouterProvider,
} from "@alepha/server";
import { routeMethods } from "@alepha/server";
import { $proxy, type ProxyDescriptorOptions } from "../descriptors/$proxy.ts";

export class ServerProxyProvider {
	protected readonly routerProvider = $inject(ServerRouterProvider);
	protected readonly alepha = $inject(Alepha);

	public readonly configure = $hook({
		name: "configure",
		handler: async () => {
			const proxies = this.alepha.getDescriptorValues($proxy);
			for (const { value } of proxies) {
				if (value[OPTIONS].disabled) {
					continue;
				}

				await this.proxy(value[OPTIONS]);
			}
		},
	});

	public async proxy(options: ProxyDescriptorOptions) {
		const path = options.path;
		const target = options.target;
		const handler: ServerHandler = async (request) => {
			const url = new URL(request.url.pathname, target);
			if (request.url.search) {
				url.search = request.url.search;
			}

			options.rewrite?.(url);

			const requestInit = {
				url: url.toString(),
				method: request.method,
				headers: request.headers,
				body: this.getRawRequestBody(request),
			};

			if (requestInit.body) {
				(requestInit as any).duplex = "half";
			}

			if (options.beforeRequest) {
				await options.beforeRequest(request, requestInit);
			}

			const response = await fetch(requestInit.url, requestInit);

			request.reply.status = response.status;
			request.reply.headers = Object.fromEntries(response.headers.entries());
			request.reply.body = response.body;

			if (options.afterResponse) {
				await options.afterResponse(request, response);
			}
		};

		for (const method of routeMethods) {
			await this.routerProvider.route({
				method,
				path,
				handler,
			});
		}

		this.alepha.log.info("Proxying", { path, target });
	}

	private getRawRequestBody(req: ServerRequest): any {
		const { method } = req;

		if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
			return;
		}

		// Node.js request
		if (req.raw.node?.req) {
			return req.raw.node.req;
		}
	}
}
