import { randomUUID } from "node:crypto";
import { $hook, $inject, Alepha } from "@alepha/core";
import type { Permission } from "@alepha/security";
import { JwtProvider, SecurityProvider } from "@alepha/security";
import {} from "fastify";
import type { RouteMethod } from "../descriptors/$route.ts";
import { routeMethods } from "../descriptors/$route.ts";
import { HttpClient } from "../services/HttpClient.ts";
import type { HttpRouteDefinition } from "./fastify/FastifyServerProvider.ts";

export class ServerSecurityProvider {
	protected readonly securityProvider = $inject(SecurityProvider);
	protected readonly jwtProvider = $inject(JwtProvider);
	protected readonly alepha = $inject(Alepha);
	protected readonly fetchFactory = $inject(HttpClient);

	protected readonly configure = $hook({
		name: "configure",
		handler: async () => {
			if (this.alepha.isTest()) {
				this.fetchFactory.on("beforeFetch", async (ev) => {
					if (!ev.headers.authorization) {
						ev.headers.authorization = await this.jwtProvider.create({
							sub: ev.options.test?.userId ?? randomUUID(),
							roles: ev.options.test?.roles ?? ["admin"],
						});
					}
				});
			}
		},
	});

	protected readonly onConfigureFastify = $hook({
		name: "server:onRequest",
		priority: "last",
		handler: async ({ request, route }) => {
			const schema = route.schema;
			const secure = !!schema?.security;

			if (!secure) {
				try {
					request.user = await this.securityProvider.createUserFromToken(
						request.headers.get("authorization"),
					);
				} catch (error) {
					// Ignore error if no token is provided
				}
				return;
			}

			const method = this.method(route.method);
			if (!method) {
				return;
			}

			const permission = this.getPermissionFromRoute({
				method,
				url: route.url,
				schema,
			});

			if (!permission) {
				return;
			}

			request.user = await this.securityProvider.createUserFromToken(
				request.headers.get("authorization"),
				permission,
			);
		},
	});

	protected readonly onRoute = $hook({
		name: "server:onRoute",
		handler: async ({ route }) => {
			if (!route.schema) {
				return;
			}

			const method = this.method(route.method);
			if (!method) {
				return;
			}

			const permission = this.getPermissionFromRoute({
				method,
				url: route.url,
				schema: route.schema,
			});

			if (permission) {
				this.securityProvider.createPermission(permission);
			}
		},
	});

	/**
	 * Retrieves the permission from the given route.
	 *
	 * @param route - The route object from which to retrieve the permission.
	 * @return The permission associated with the route, or undefined if not found.
	 */
	public getPermissionFromRoute(
		route: HttpRouteDefinition,
	): Permission | undefined {
		const schema = route.schema;
		if (
			schema &&
			"operationId" in schema &&
			typeof schema.operationId === "string"
		) {
			const group = schema.tags?.[0]?.toLowerCase();
			return {
				group,
				name: schema.operationId,
				method: route.method,
				url: route.url,
				description: schema.summary,
			};
		}
	}

	/**
	 * Retrieves the method from the given request.
	 *
	 * @param raw - Raw method string.
	 * @return The method associated with the request.
	 */
	protected method(raw: string | string[]): RouteMethod | undefined {
		const methods = (Array.isArray(raw) ? raw : [raw]).map((it) =>
			it.toLowerCase(),
		);
		for (const method of methods) {
			if (routeMethods.includes(method as RouteMethod)) {
				return method as RouteMethod;
			}
		}
	}
}
