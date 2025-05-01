import { Readable } from "node:stream";
import {
	$hook,
	$inject,
	$logger,
	Alepha,
	KIND,
	NotImplementedError,
	PROVIDER,
	type Static,
	t,
} from "@alepha/core";
import {
	SecurityModule,
	SecurityProvider,
	type UserAccountToken,
} from "@alepha/security";
import { $proxy } from "../descriptors/$proxy";
import { $remote } from "../descriptors/$remote";
import type {
	RequestConfig,
	RouteDescriptor,
	RouteFetchRequestOptions,
	RouteGenericRequestOptions,
	RouteHandlerArgs,
	RouteRequestArgs,
} from "../descriptors/$route";
import { $route } from "../descriptors/$route";
import type { RouteContext } from "../descriptors/$route.ts";
import { $serve } from "../descriptors/$serve";
import { ForbiddenError } from "../errors/ForbiddenError";
import { UnauthorizedError } from "../errors/UnauthorizedError";
import { CookieManager } from "../helpers/CookieManager";
import { HeaderManager } from "../helpers/HeaderManager.ts";
import { RouteDescriptorHelper } from "../helpers/RouteDescriptorHelper";
import { streamToBuffer } from "../helpers/streamToBuffer";
import { HttpClient } from "../services/HttpClient";
import type { HttpConfig } from "./ServerProvider";
import { ServerProvider } from "./ServerProvider";
import type { RouteObject } from "./ServerProvider.ts";

const envSchema = t.object({
	/**
	 * The prefix for the API routes.
	 */
	SERVER_API_PREFIX: t.string({
		default: "/api",
	}),
	/**
	 *
	 */
	SERVER_SECURITY_ENABLED: t.boolean({
		default: false,
		description: "Enable security for all endpoints by default.",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
	interface Hooks {
		"server:onRequest": {
			request: RouteHandlerArgs;
			context: RouteContext;
			route: RouteObject;
		};
		"server:onRoute": {
			route: RouteObject;
		};
		"server:onSend": {
			request: RouteHandlerArgs;
			context: RouteContext;
			route: RouteObject;
			status: number;
			ms: number;
		};
	}
}

export class RouteServerDescriptorProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);
	protected readonly client = $inject(HttpClient);
	protected readonly serverProvider = $inject(ServerProvider);
	protected readonly helper = $inject(RouteDescriptorHelper);
	protected readonly remotes: Array<{ api: object; url: string }> = [];

	protected readonly configure = $hook({
		name: "configure",
		handler: async () => {
			await this.processDescriptors();
		},
	});

	/**
	 * Registers all routes with the Fastify server.
	 */
	protected async processDescriptors() {
		const remotes = this.alepha.getDescriptorValues($remote);
		for (const { value } of remotes) {
			this.remotes.push(value.options);
		}

		const serves = this.alepha.getDescriptorValues($serve);
		for (const { value } of serves) {
			await this.serverProvider.serve(value.options);
		}

		const proxies = this.alepha.getDescriptorValues($proxy);
		for (const { value } of proxies) {
			await this.serverProvider.proxy(value.options);
		}

		const routes = this.alepha.getDescriptorValues($route);
		for (const { value, key, instance } of routes) {
			await this.route(value, key, instance);
		}
	}

	/**
	 * Creates a route for the specified value.
	 *
	 * @param routeDescriptor
	 * @param key
	 * @param instance
	 * @protected
	 */
	protected async route(
		routeDescriptor: RouteDescriptor,
		key: string,
		instance: any,
	) {
		const { options } = routeDescriptor;
		const hasSecurity = this.alepha.has(SecurityModule);

		const handler = options.handler;
		if (!handler) {
			this.handleRouteApi(routeDescriptor, instance, key);
			return;
		}

		if (options.disabled) {
			this.log.trace(`- '${instance.constructor.name}#${key}' is disabled`);
			return;
		}

		const schema: any = {
			security: options.security === false ? undefined : [],
		};

		const name = options.name ?? key;
		const group = this.helper.group(options, instance);

		if (options.internal) {
			schema.hide = true;
		}

		if (hasSecurity && options.security !== false) {
			schema.security = [];
		}

		schema.operationId ??= name;
		schema.tags ??= [group];
		schema.summary ??= routeDescriptor.options.summary;

		if (options.schema) {
			if (options.schema.body) schema.body ??= options.schema.body;
			if (options.schema.params) schema.params ??= options.schema.params;
			if (options.schema.query) schema.query ??= options.schema.query;
			if (options.schema.response) {
				schema.response ??= {
					200: options.schema.response,
				};
			}
		}

		const permission = this.helper.permission(options, instance, key);

		const method = this.helper.method(options);

		const url = this.helper.url(
			options,
			instance,
			key,
			this.env.SERVER_API_PREFIX,
		);

		routeDescriptor.options.url = url;
		routeDescriptor.options.method = method;

		const lazyHostname = () => this.serverProvider.hostname;
		const fetcher = this.client.createFetcher(routeDescriptor.options, {
			get host() {
				return lazyHostname();
			},
		});

		const methods = {
			permission: () => permission,
			fetch: (cfg: RouteRequestArgs, opt?: RouteFetchRequestOptions) =>
				fetcher(cfg, opt),
			local: this.createLocalFunction(routeDescriptor, permission),
		};

		const $ = (
			config: RouteRequestArgs,
			opts: RouteGenericRequestOptions = {},
		) => {
			if (opts.fetch) {
				return methods.fetch(config, opts.fetch);
			}

			return methods.local(config, opts);
		};

		$[KIND] = "ROUTE";
		$.options = routeDescriptor.options;
		$.fetch = methods.fetch;
		$.permission = methods.permission;

		instance[key] = $;

		this.log.debug(
			`+ '${method.toUpperCase()} ${url}' -> ${instance.constructor.name}#${key}`,
		);

		this.client.links ??= [];
		const local = this.createLocalFunction(routeDescriptor, permission);

		this.client.links.push({
			name,
			group,
			method,
			url,
			handler: local,
			protected: options.security !== false,
		});

		const route = {
			method,
			url,
			schema,
			handler,
			silent: options.silent,
		};

		await this.alepha.run("server:onRoute", { route });

		await this.serverProvider.route(route, options);
	}

	/**
	 * Handles the route API.
	 *
	 * @param routeDescriptor - The route descriptor.
	 * @param instance
	 * @param key
	 */
	protected handleRouteApi(
		routeDescriptor: RouteDescriptor,
		instance: any,
		key: string,
	) {
		for (const {
			value,
			instance: parentInstance,
			key: parentKey,
		} of this.alepha.getDescriptorValues($route)) {
			if (value.options.use === routeDescriptor && value.options.handler) {
				const local = this.createLocalFunction(
					value,
					this.helper.permission(value.options, instance, key),
				);
				this.log.trace(
					`${instance.constructor.name}#${key} will be a client of ${parentInstance?.constructor?.name}#${parentKey}`,
				);

				const $ = (
					config: RouteRequestArgs<RequestConfig>,
					opts: RouteGenericRequestOptions = {},
				) => {
					return local(config, opts);
				};

				$[KIND] = "ROUTE";
				$.options = routeDescriptor.options;
				$.fetch = () => {
					throw new NotImplementedError("ROUTE");
				};

				instance[key] = $;

				return;
			}
		}

		for (const resolver of this.remotes) {
			if (
				resolver.api === instance ||
				(resolver.api as any)[PROVIDER] === instance.constructor
			) {
				this.log.debug(
					`${instance.constructor.name}#${key} will be a remote client of ${resolver.url}`,
				);

				const remote = this.client.createFetcher(routeDescriptor.options, {
					host: resolver.url,
				});

				const $ = (
					config: RouteRequestArgs,
					opts: RouteGenericRequestOptions = {},
				) => remote(config, opts.fetch);

				$[KIND] = "ROUTE";
				$.options = routeDescriptor.options;
				$.fetch = (
					config: RouteRequestArgs,
					opts: RouteGenericRequestOptions = {},
				) => {
					return remote(config, opts.fetch);
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
	protected createLocalFunction(value: RouteDescriptor, permission: string) {
		return async (
			config: HttpConfig = {},
			options: RouteGenericRequestOptions = {},
		) => {
			const request = this.alepha.als.get<RouteHandlerArgs>("request");

			if (request) {
				options.user ??= request?.user;
				options.cookies ??= request?.cookies;
			}

			const body = config.body
				? value.options.schema?.body &&
					value.options.parse !== "multipart/form-data"
					? this.alepha.parse(value.options.schema.body, config.body)
					: config.body
				: undefined;

			const params = config.params
				? value.options.schema?.params
					? this.alepha.parse(value.options.schema.params, config.params)
					: config.params
				: undefined;

			const query = config.query
				? value.options.schema?.query
					? this.alepha.parse(value.options.schema.query, config.query)
					: config.query
				: {};

			const handler = value.options.handler;
			if (!handler) {
				throw new Error("No handler found for the route");
			}

			const response = await handler(
				{
					body,
					params,
					query,
					headers: new HeaderManager(),
					url: new URL(`http://localhost${value.options.url ?? ""}`),
					user: this.getUserFromLocalFunctionContext(
						options,
						permission,
						value.options.security !== false,
					),
					cookies: options.cookies ?? new CookieManager(),
				},
				{},
			);

			if (!response) {
				return new Response(null, { status: 204 });
			}

			if (response instanceof Readable) {
				return streamToBuffer(response);
			}

			return value.options.schema?.response
				? this.alepha.parse(value.options.schema.response, response)
				: response;
		};
	}

	/**
	 * Get the user from the current context.
	 *
	 * @param options - Options from context (http, local, ...)
	 * @param permission - The permission required for the route.
	 * @param security - If route is secured or not.
	 */
	protected getUserFromLocalFunctionContext(
		options: { user?: Partial<UserAccountToken> },
		permission: string,
		security: boolean,
	): UserAccountToken | undefined {
		const id = options.user?.id;

		if (security && this.env.SERVER_SECURITY_ENABLED && "user" in options) {
			if (options.user === undefined) {
				throw new UnauthorizedError("User is required for this route");
			}

			if (!id) {
				throw new UnauthorizedError("Invalid user id");
			}

			const roles = options.user?.roles ?? [];
			const hasSecurity = this.alepha.has(SecurityProvider);
			if (hasSecurity) {
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
	 * Creates a system user.
	 *
	 * @protected
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
