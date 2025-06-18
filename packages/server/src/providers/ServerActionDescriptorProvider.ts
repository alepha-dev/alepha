import { type Cache, CacheDescriptorProvider } from "@alepha/cache";
import {
	$hook,
	$inject,
	$logger,
	Alepha,
	isFileLike,
	isTypeFile,
	KIND,
	OPTIONS,
	type Static,
	t,
} from "@alepha/core";
import { isDurationLike } from "@alepha/datetime";
import {
	type Permission,
	SecurityProvider,
	type ServiceAccountDescriptor,
	type UserAccountToken,
} from "@alepha/security";
import type { RouteMethod } from "../constants/routeMethods.ts";
import {
	$action,
	type ActionDescriptor,
	type ActionDescriptorOptions,
	type ClientRequestEntry,
	type ClientRequestOptions,
} from "../descriptors/$action.ts";
import { ForbiddenError } from "../errors/ForbiddenError.ts";
import { UnauthorizedError } from "../errors/UnauthorizedError.ts";
import { ActionDescriptorHelper } from "../helpers/ActionDescriptorHelper.ts";
import type { ApiLinksResponse } from "../schemas/apiLinksResponseSchema.ts";
import { HttpClient } from "../services/HttpClient.ts";
import { ServerProvider } from "./platforms/ServerProvider.ts";
import {
	type RequestConfigSchema,
	type ServerRequest,
	type ServerRequestConfigEntry,
	type ServerRoute,
	ServerRouterProvider,
} from "./ServerRouterProvider.ts";

const envSchema = t.object({
	SERVER_API_PREFIX: t.string({
		description: "Prefix for all API routes (e.g. $action).",
		default: "/api",
	}),
	SERVER_SECURITY_ENABLED: t.boolean({
		description: "Enable security for all endpoints by default.",
		default: false,
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class ServerActionDescriptorProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);
	protected readonly client = $inject(HttpClient);
	protected readonly serverProvider = $inject(ServerProvider);
	protected readonly helper = $inject(ActionDescriptorHelper);
	protected readonly routerProvider = $inject(ServerRouterProvider);
	protected readonly caches = $inject(CacheDescriptorProvider);
	protected readonly actions: ServerRouteAction[] = [];

	public getActions() {
		return this.actions;
	}

	public getPrefix() {
		return this.env.SERVER_API_PREFIX;
	}

	public readonly configure = $hook({
		name: "configure",
		handler: async () => {
			const routes = this.alepha.getDescriptorValues($action);
			for (const { value, key, instance } of routes) {
				await this.registerAction(value, key, instance);
			}
		},
	});

	public async registerAction(
		value: ActionDescriptor,
		key: string,
		instance: any,
		prefix = this.env.SERVER_API_PREFIX,
	) {
		const options = value[OPTIONS] as ActionDescriptorOptions;
		const path = this.helper.path(options, instance, key);

		if (options.disabled) {
			this.log.trace(`'${instance.constructor.name}#${key}' is disabled`);
			return;
		}

		if (!options.handler) {
			this.log.warn(
				`No handler found for the route ${instance.constructor.name}#${key}`,
			);
			return;
		}

		const cache = this.useActionCache(options, instance, key);

		const action: ServerRouteAction = {
			...options,
			prefix,
			method: this.helper.method(options),
			path,
			name: this.helper.name(options, instance, key),
			group: this.helper.group(options, instance),
			permission: this.helper.permission(options, instance, key),
			schema: options.schema,
			handler: options.handler,
			options,
		};

		this.actions.push(action);

		// --- Routing

		await this.routerProvider.route({
			...action,
			handler: options.handler,
			path: `${action.prefix}${action.path}`,
		});

		// --- Log

		this.log.debug(
			`+ '${action.method} ${action.path}' -> ${instance.constructor.name}#${key}`,
		);

		// --- Descriptor $action

		const functions = {
			permission: () => action.permission,
			fetch: this.client.createFetchFunction(action, {
				host: () => this.serverProvider.hostname,
			}),
			local: this.createLocalFunction(options, action.permission),
		};

		const $ = (
			config: Partial<ClientRequestEntry> = {},
			opts: ClientRequestOptions = {},
		) => {
			return functions.local(config, opts);
		};

		$[KIND] = "ROUTE";
		$.options = action.options;
		$.fetch = functions.fetch;
		$.permission = functions.permission;
		$.invalidate = async () => {
			if (cache) {
				await this.caches.invalidate(cache);
			} else {
				this.log.warn(
					`Action '${instance.constructor.name}#${key}' has no cache enabled, cannot invalidate.`,
				);
			}
		};

		instance[key] = $;

		// -- Links

		if (action.options.internal) {
			return;
		}

		this.client.pushLink({
			...action,
			schema: action.options.schema,
			requestBodyType: this.helper.bodyContentType(action.options),
			handler: functions.local,
			secured: options.security !== false,
			method: action.method === "GET" ? undefined : action.method,
			prefix: this.env.SERVER_API_PREFIX,
			path: action.path.replace(this.env.SERVER_API_PREFIX, ""),
		});
	}

	protected useActionCache(
		options: ActionDescriptorOptions,
		instance: any,
		key: string,
	) {
		if (!options.cache) {
			return;
		}

		const cache: Cache = {
			group: `${instance.constructor.name}:${key}`,
			options:
				typeof options.cache === "boolean"
					? {
							ttl: { minutes: 5 },
						}
					: isDurationLike(options.cache)
						? {
								ttl: options.cache,
							}
						: {
								...options.cache,
							},
		};

		const ref = options.handler;
		if (!ref) {
			return;
		}

		cache.options.key = (args: any) =>
			JSON.stringify({
				query: args.query ?? {},
				params: args.params ?? {},
				body: args.body ?? {},
			});

		cache.options.handler = ref;

		options.handler = (args: any) => {
			return this.caches.run(cache, args);
		};

		return cache;
	}

	/**
	 * Check a mock function for the specified route.
	 *
	 * This is mostly used for testing purposes.
	 *
	 * @param value
	 * @param permission
	 * @protected
	 */
	protected createLocalFunction(
		action: ActionDescriptorOptions,
		permission: Permission,
	) {
		return async (
			config: ServerRequestConfigEntry = {},
			options: ClientRequestOptions = {},
		): Promise<any> => {
			const request = this.alepha.context.get<ServerRequest>("request");
			if (request) {
				options.user ??= request?.user;
			}

			// TODO: hook - "local:onRequest" ?

			const handler = action.handler;
			if (!handler) {
				throw new Error("No handler found for the route");
			}

			const user = this.getUserFromLocalFunctionContext(
				options,
				permission,
				action.security !== false,
			);

			const serverActionRequest: Partial<ServerRequest> = {
				...request,
				...options,
				method: action.method ?? "GET",
				url: new URL(`http://localhost${action.path ?? ""}`),
				body: config.body,
				params: config.params ?? {},
				query: config.query ?? {},
				headers: config.headers ?? {},
				reply: {
					headers: {},
					redirect: () => {},
				},
				metadata: {},
				raw: {},
				user,
			};

			this.routerProvider.validateRequest(
				action,
				serverActionRequest as ServerRequest,
			);

			const response = await handler(serverActionRequest as ServerRequest);

			if (action.schema?.response) {
				if (isTypeFile(action.schema.response) && isFileLike(response)) {
					return response;
				}
				return this.alepha.parse<any>(action.schema?.response, response);
			}

			return response;
		};
	}

	/**
	 * Security adapted for local function.
	 */
	protected getUserFromLocalFunctionContext(
		options: { user?: Partial<UserAccountToken> },
		permission: Permission,
		security: boolean,
	): UserAccountToken | undefined {
		const id = options.user?.id;
		const hasSecurity = this.alepha.has(SecurityProvider);

		if (security && hasSecurity && "user" in options) {
			if (options.user === undefined) {
				throw new UnauthorizedError("User is required for this route");
			}

			if (!id) {
				throw new UnauthorizedError("Invalid user id");
			}

			const roles = options.user?.roles ?? [];
			const securityProvider = this.alepha.get(SecurityProvider);

			// Note: we don't check JWT here, it's just a simple role check.
			const result = securityProvider.checkPermission(permission, ...roles);
			if (!result.isAuthorized) {
				throw new ForbiddenError(
					`Permission '${securityProvider.permissionToString(permission)}' is required for this route`,
				);
			}

			// new user from security layer (with new permission/ownership)
			return {
				...options.user,
				id,
				ownership: result.ownership,
			};
		}

		// current user from request
		if (id) {
			return {
				...options.user,
				id,
			};
		}

		// here, we assume that route is not secured or security is ignored

		// if route is not protected, user=undefined is fine
		if (!security) {
			return undefined;
		}

		// if route is really secured, we create a system user
		return this.createSystemUser();
	}

	/**
	 * TODO: remove it, this is a hack for testing purposes
	 */
	protected createSystemUser(): UserAccountToken {
		return {
			id: "3b07c364-707d-46e9-ad5b-d6f455eb3207",
			name: "System",
			roles: ["admin"],
		};
	}
}

// ----------------------------------------------------------------------------------------------------------

export const isServerAction = (value: any): value is ServerRouteAction => {
	return (
		typeof value === "object" &&
		typeof value.name === "string" &&
		typeof value.group === "string"
	);
};

// ----------------------------------------------------------------------------------------------------------

export interface ServerRemote {
	url: string;
	name: string;
	proxy: boolean;
	internal: boolean;
	links: (args: { authorization?: string }) => Promise<ApiLinksResponse>;
	schema: (args: { name: string; authorization?: string }) => Promise<any>;
	serviceAccount?: ServiceAccountDescriptor;
	prefix: string;
}

export interface ServerRouteAction<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> extends ServerRoute<TConfig> {
	prefix: string;
	method: RouteMethod;
	name: string;
	group: string;
	permission: Permission;
	options: ActionDescriptorOptions;
}
