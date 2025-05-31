import { $hook, $inject, Alepha, OPTIONS } from "@alepha/core";
import { $route } from "../descriptors/$route.ts";
import { ServerRouterProvider } from "./ServerRouterProvider.ts";

export class ServerRouteDescriptorProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);

	public readonly configure = $hook({
		name: "configure",
		handler: async () => {
			const routes = this.alepha.getDescriptorValues($route);
			for (const { value } of routes) {
				await this.serverRouterProvider.route(value[OPTIONS]);
			}
		},
	});
}
