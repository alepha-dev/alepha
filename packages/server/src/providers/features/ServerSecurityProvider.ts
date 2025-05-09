import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import { SecurityProvider } from "@alepha/security";
import { isServerAction } from "../ServerActionDescriptorProvider.ts";

export class ServerSecurityProvider {
	protected readonly log = $logger();
	protected readonly securityProvider = $inject(SecurityProvider);
	protected readonly alepha = $inject(Alepha);

	protected readonly onRequest = $hook({
		name: "server:onRequest",
		priority: "last",
		handler: async ({ request, route }) => {
			if (!isServerAction(route)) {
				try {
					request.user = await this.securityProvider.createUserFromToken(
						request.headers.authorization,
					);
				} catch (error) {
					// Ignore error if no token is provided
					this.log.trace("Error while creating user from token", { error });
				}
				return;
			}

			const secure = route.options.security !== false;
			if (!secure) {
				try {
					request.user = await this.securityProvider.createUserFromToken(
						request.headers.authorization,
					);
				} catch (error) {
					// Ignore error if no token is provided
					this.log.trace("Error while creating user from token", { error });
				}
				return;
			}

			if (!route.permission) {
				return;
			}

			request.user = await this.securityProvider.createUserFromToken(
				request.headers.authorization,
				route.permission,
			);
		},
	});

	protected readonly onRoute = $hook({
		name: "server:onRoute",
		handler: async ({ route }) => {
			if (!isServerAction(route)) {
				return;
			}

			if (route.permission) {
				this.securityProvider.createPermission(route.permission);
			}
		},
	});
}
