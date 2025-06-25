import { randomUUID } from "node:crypto";
import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import { JwtProvider, SecurityProvider } from "@alepha/security";
import { isServerAction } from "../ServerActionDescriptorProvider.ts";

export class ServerSecurityProvider {
	protected readonly log = $logger();
	protected readonly securityProvider = $inject(SecurityProvider);
	protected readonly jwtProvider = $inject(JwtProvider);
	protected readonly alepha = $inject(Alepha);

	public readonly onClientRequest = $hook({
		name: "client:onRequest",
		handler: async ({ request, options }) => {
			const realms = this.securityProvider.getRealms();
			if (!this.alepha.isTest()) {
				return;
			}

			if (realms.length !== 1 || realms[0].name !== "default") {
				return;
			}

			request.headers = new Headers(request.headers);

			if (!request.headers.has("authorization")) {
				const user =
					typeof options?.user === "object" ? options.user : undefined;
				const sub = user?.id ?? randomUUID();
				const roles = user?.roles ?? ["admin"];
				request.headers.set(
					"authorization",
					`Bearer ${await this.jwtProvider.create(
						{
							sub,
							roles,
						},
						"default",
					)}`,
				);
			}
		},
	});

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
