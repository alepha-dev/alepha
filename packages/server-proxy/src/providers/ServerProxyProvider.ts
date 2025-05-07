import { $hook, $inject, Alepha } from "@alepha/core";
import { ServerRouterProvider } from "@alepha/server";
import { $proxy, type ProxyDescriptorOptions } from "../descriptors/$proxy.ts";

export class ServerProxyProvider {
	protected readonly routerProvider = $inject(ServerRouterProvider);
	protected readonly alepha = $inject(Alepha);

	public readonly configure = $hook({
		name: "configure",
		handler: async () => {
			const proxies = this.alepha.getDescriptorValues($proxy);
			for (const { value, instance, key } of proxies) {
				if (value.options.disabled) {
					continue;
				}

				this.proxy(value.options);
			}
		},
	});

	public proxy(options: ProxyDescriptorOptions) {
		const path = options.path;
		const target = options.target;

		this.routerProvider.route({
			path,
			handler: async (request) => {
				const url = new URL(request.url.pathname, target);
				if (request.url.search) {
					url.search = request.url.search;
				}

				const requestInit = {
					url: url.toString(),
					method: request.method,
					headers: request.headers,
					body: request.body,
				};

				if (requestInit.body) {
					(requestInit as any).duplex = "half";
				}

				if (options.beforeRequest) {
					await options.beforeRequest(request, requestInit);
				}

				const response = await fetch(requestInit.url, requestInit);

				request.reply.status = response.status;

				for (const [header, value] of response.headers.entries()) {
					if (header === "content-length") {
						continue;
					}

					request.reply.headers[header] = value;
				}

				request.reply.body = response.body;

				if (options.afterResponse) {
					await options.afterResponse(request, response);
				}
			},
		});

		this.alepha.log.info("Proxying", { path, target });
	}
}
