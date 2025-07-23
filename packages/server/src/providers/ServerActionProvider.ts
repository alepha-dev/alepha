import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import { $action } from "../descriptors/$action.ts";
import { ServerRouterProvider } from "./ServerRouterProvider.ts";

export class ServerActionProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);

	protected readonly onConfigure = $hook({
		on: "configure",
		handler: async () => {
			await Promise.all(
				this.alepha.descriptors($action).map(async (action) => {
					this.log.debug(
						`+ '${action.method} ${action.path}' -> ${action.config.service.name}#${action.config.propertyKey}`,
					);
					await this.serverRouterProvider.createRoute(action.route);
				}),
			);
		},
	});
}
