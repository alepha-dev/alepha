import {
	$hook,
	$inject,
	$logger,
	Alepha,
	type Logger,
	OPTIONS,
} from "@alepha/core";
import {
	routeMethods,
	type ServerHandler,
	type ServerRequest,
	ServerRouterProvider,
} from "@alepha/server";
import { $proxy, type ProxyDescriptorOptions } from "../descriptors/$proxy.ts";

export class ProxyDescriptorProvider {
	protected readonly log: Logger = $logger();
	protected readonly routerProvider: ServerRouterProvider =
		$inject(ServerRouterProvider);
	protected readonly alepha = $inject(Alepha);

	public readonly configure = $hook({
		on: "configure",
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

	public createProxyHandler(
		target: string,
		options: Omit<ProxyDescriptorOptions, "path">,
	): ServerHandler {
		return async (request) => {
			const url = new URL(target + request.url.pathname);
			if (request.url.search) {
				url.search = request.url.search;
			}

			options.rewrite?.(url);

			const requestInit = {
				url: url.toString(),
				method: request.method,
				headers: {
					...request.headers,
					"accept-encoding": "identity", // ignore compression
				},
				body: this.getRawRequestBody(request),
			};

			if (requestInit.body) {
				(requestInit as any).duplex = "half";
			}

			if (options.beforeRequest) {
				await options.beforeRequest(request, requestInit);
			}

			this.log.debug("Proxying request", {
				url: url.toString(),
				method: request.method,
				headers: request.headers,
			});

			const response = await fetch(requestInit.url, requestInit);

			request.reply.status = response.status;
			request.reply.headers = Object.fromEntries(response.headers.entries());
			request.reply.body = response.body;

			this.log.debug("Received response", {
				status: request.reply.status,
				headers: request.reply.headers,
			});

			if (options.afterResponse) {
				await options.afterResponse(request, response);
			}
		};
	}

	public async proxy(options: ProxyDescriptorOptions): Promise<void> {
		const path = options.path;
		const target =
			typeof options.target === "function" ? options.target() : options.target;
		const handler: ServerHandler = this.createProxyHandler(target, options);

		if (!path.endsWith("/*")) {
			throw new Error("Proxy path should end with '/*'");
		}

		for (const method of routeMethods) {
			await this.routerProvider.createRoute({
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
