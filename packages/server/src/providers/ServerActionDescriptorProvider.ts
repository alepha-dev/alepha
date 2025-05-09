import {
	$hook,
	$inject,
	$logger,
	Alepha,
	KIND,
	type Static,
	TypeGuard,
	t,
} from "@alepha/core";
import {
	type Permission,
	SecurityProvider,
	type UserAccountToken,
} from "@alepha/security";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type {
	ClientRequestEntry,
	ClientRequestOptions,
	RouteDescriptor,
	RouteDescriptorOptions,
} from "../descriptors/$action.ts";
import { $route } from "../descriptors/$action.ts";
import { $remote, type RemoteDescriptor } from "../descriptors/$remote.ts";
import { ForbiddenError } from "../errors/ForbiddenError.ts";
import { UnauthorizedError } from "../errors/UnauthorizedError.ts";
import { RouteDescriptorHelper } from "../helpers/RouteDescriptorHelper.ts";
import { HttpClient } from "../services/HttpClient.ts";
import {
	type RequestConfigSchema,
	type ServerRequest,
	type ServerRequestConfigEntry,
	type ServerRoute,
	ServerRouterProvider,
} from "./ServerRouterProvider.ts";
import { ServerProvider } from "./platforms/ServerProvider.ts";

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
	protected readonly helper = $inject(RouteDescriptorHelper);
	protected readonly routerProvider = $inject(ServerRouterProvider);

	protected readonly remotes: Array<ServerRemote> = [];
	protected readonly actions: ServerRouteAction[] = [];

	public getActions() {
		return this.actions;
	}

	public readonly configure = $hook({
		name: "configure",
		handler: async () => {
			const remotes = this.alepha.getDescriptorValues($remote);
			for (const { value, key } of remotes) {
				this.registerRemote(value, key);
			}
			const routes = this.alepha.getDescriptorValues($route);
			for (const { value, key, instance } of routes) {
				this.registerAction(value, key, instance);
			}
		},
	});

	public registerRemote(value: RemoteDescriptor, key: string) {
		this.remotes.push({
			url:
				typeof value.options.url === "string"
					? value.options.url
					: value.options.url(),
			name: value.options.name ?? key,
			services: Array.isArray(value.options.services)
				? value.options.services
				: [value.options.services],
		});
	}

	public registerAction(
		value: RouteDescriptor,
		key: string,
		instance: any,
		prefix = this.env.SERVER_API_PREFIX,
	) {
		const options = value.options as RouteDescriptorOptions;
		const path = this.helper.path(options, instance, key, prefix);

		if (options.disabled) {
			this.log.trace(`'${instance.constructor.name}#${key}' is disabled`);
			return;
		}

		const handler = value.options.handler;
		if (!handler) {
			this.registerActionApi(value, instance, key);
			return;
		}

		const action: ServerRouteAction = {
			...options,
			method: this.helper.method(options),
			path,
			name: this.helper.name(options, instance, key),
			group: this.helper.group(options, instance),
			permission: this.helper.permission(options, instance, key),
			schema: options.schema,
			handler,
			options,
		};

		this.actions.push(action);

		// --- Routing

		this.routerProvider.route(action);

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
			local: this.createLocalFunction(value, action.permission),
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

		instance[key] = $;

		// -- Links

		this.client.links ??= [];

		this.client.links.push({
			...action,
			schema: action.options.schema,
			contentType: this.helper.bodyContentType(action.options),
			handler: functions.local,
			protected: options.security !== false,
		});
	}

	/**
	 * When your action has no handler, it's considered as an 'API'.
	 * Instead of creating an http route, create a bridge to a local or remote function.
	 *
	 * ```ts
	 * class Api {
	 *   hello = $action(); // <- route 'Api'
	 * }
	 *
	 * class Controller {
	 *   api = $inject(Api);
	 *   hello = $action({ // <-- route
	 *     use: this.api.hello,
	 *     handler: () => new Response("Hello world"),
	 *   })
	 * }
	 *
	 * const api = alepha.get(Api);
	 *
	 * api.hello(); // <-- call the local controller function if available
	 *
	 * // or with $remote
	 * class Remotes {
	 *   api = $remote({ url: "http://localhost:8080", services: [Api] });
	 * }
	 *
	 * // or with future auto-discovery
	 * ```
	 */
	public registerActionApi(
		routeDescriptor: RouteDescriptor,
		instance: any,
		key: string,
	) {
		const routes = this.alepha.getDescriptorValues($route);
		for (const it of routes) {
			const { value, instance: parentInstance, key: parentKey } = it;

			// find controller
			if (value.options.use === routeDescriptor && value.options.handler) {
				const localFunction = this.createLocalFunction(
					value,
					this.helper.permission(value.options, instance, key),
				);

				this.log.trace(
					`${instance.constructor.name}#${key} will be a client of ${parentInstance?.constructor?.name}#${parentKey}`,
				);

				// ---

				const $ = (
					config: Partial<ClientRequestEntry> = {},
					opts: ClientRequestOptions = {},
				) => {
					return localFunction(config, opts);
				};

				$[KIND] = "ROUTE";
				$.options = routeDescriptor.options;

				$.fetch = (
					config: Partial<ClientRequestEntry> = {},
					opts: ClientRequestOptions = {},
				) => localFunction(config, opts);

				instance[key] = $;

				return;
			}
		}

		for (const resolver of this.remotes) {
			if (resolver.services.includes(instance)) {
				this.log.debug(
					`${instance.constructor.name}#${key} will be a remote client to ${resolver.url}`,
				);

				// Fetcher is shared with BrowserActionDescriptorProvider, both make http calls with 'fetch()'
				const remoteFunction = this.client.createFetchFunction(
					this.helper.link(
						routeDescriptor.options,
						instance,
						key,
						this.env.SERVER_API_PREFIX,
					),
					{
						host: resolver.url,
					},
				);

				const $ = (
					config: Partial<ClientRequestEntry> = {},
					opts: ClientRequestOptions = {},
				) => remoteFunction(config, opts);

				$[KIND] = "ROUTE";
				$.options = routeDescriptor.options;
				$.fetch = (
					config: Partial<ClientRequestEntry> = {},
					opts: ClientRequestOptions = {},
				) => {
					return remoteFunction(config, opts);
				};

				instance[key] = $;

				return;
			}
		}

		this.log.warn(
			`No handler found for the route ${instance.constructor.name}#${key}`,
		);
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
		value: RouteDescriptor,
		permission: Permission,
	) {
		return async (
			config: ServerRequestConfigEntry = {},
			options: ClientRequestOptions = {},
		): Promise<any> => {
			const request = this.alepha.als.get<ServerRequest>("request");
			if (request) {
				options.user ??= request?.user;
				//options.cookies ??= request?.cookies;
			}
			// TODO: hook - "local:onRequest" ? forward cookies like this

			config.params ??= {};
			config.query ??= {};
			config.headers ??= {};

			this.routerProvider.validateRequest(value.options, {
				params: config.params,
				query: config.query,
				headers: config.headers,
				body: config.body,
			});

			const handler = value.options.handler;
			if (!handler) {
				throw new Error("No handler found for the route");
			}

			const user = this.getUserFromLocalFunctionContext(
				options,
				permission,
				value.options.security !== false,
			);

			const serverActionRequest: ServerRequest = {
				...options,
				method: value.options.method ?? "GET",
				url: new URL(`http://localhost${value.options.path ?? ""}`),
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
				cookies: {
					req: {},
					res: {},
				},
				user: user as UserAccountToken, // we lie
			};

			const response = await handler(serverActionRequest);
			if (!response) {
				return;
			}

			if (TypeGuard.IsVoid(value.options.schema?.response)) {
				return;
			}

			// TODO: handle file/blob/buffer & stream

			return value.options.schema?.response
				? this.alepha.parse(value.options.schema.response, response)
				: response;
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

		/// during testing, security is disabled by default -> we create a fake user
		if (this.alepha.isTest()) {
			return {
				...this.createSystemUser(),
				...options.user,
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
			id: "00000000-0000-0000-0000-000000000000",
			name: "System",
			roles: [
				{
					name: "system",
					permissions: [{ name: "*" }],
				},
			],
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
	services: object[];
	name: string;
}

export interface ServerRouteAction<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> extends ServerRoute<TConfig> {
	method: RouteMethod;
	name: string;
	group: string;
	permission: Permission;
	options: RouteDescriptorOptions;
}
