import { randomUUID } from "node:crypto";
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
import { ServerReply } from "../helpers/ServerReply.ts";
import type {
	RequestConfigSchema,
	ServerRequest,
	ServerRequestConfigEntry,
	ServerRoute,
} from "../interfaces/index.ts";
import type { ApiLinksResponse } from "../schemas/apiLinksResponseSchema.ts";
import { HttpClient } from "../services/HttpClient.ts";
import { ServerProvider } from "./platforms/ServerProvider.ts";
import { ServerRouterProvider } from "./ServerRouterProvider.ts";

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

	interface State {
		/**
		 * Real (or fake) user account, used for internal actions.
		 * If you define this, you assume that all actions are executed by this user by default.
		 * And to force a different user, you need to pass it explicitly in the options.
		 */
		"ServerSecurityProvider.localSystemUser"?: UserAccountToken;
	}
}

export class ServerActionDescriptorProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);
	protected readonly client = $inject(HttpClient);
	protected readonly serverProvider = $inject(ServerProvider);
	protected readonly helper = $inject(ActionDescriptorHelper);
	protected readonly routerProvider = $inject(ServerRouterProvider);
	protected readonly actions: ServerRouteAction[] = [];

	public getActions() {
		return this.actions;
	}

	public getPrefix() {
		return this.env.SERVER_API_PREFIX;
	}

	public readonly configure = $hook({
		on: "configure",
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

		const permission = this.helper.permission(options, instance, key);
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
			localHandler: this.createLocalHandler(options, permission),
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

		const $ = (
			config: Partial<ClientRequestEntry> = {},
			opts: ClientRequestOptions = {},
		) => action.localHandler(config, opts);

		$[KIND] = "ACTION";
		$[OPTIONS] = action.options;
		$.fetch = (
			config: Partial<ClientRequestEntry> = {},
			options: ClientRequestOptions = {},
		) => {
			return this.client.fetchAction({
				action,
				host: this.serverProvider.hostname,
				config,
				options,
			});
		};
		$.permission = () => action.permission;

		instance[key] = $;
	}

	/**
	 * Check a mock function for the specified route.
	 *
	 * This is mostly used for testing purposes.
	 */
	protected createLocalHandler(
		action: ActionDescriptorOptions,
		permission: Permission,
	) {
		return async (
			config: ServerRequestConfigEntry = {},
			options: ClientRequestOptions = {},
		): Promise<any> => {
			const request = this.alepha.context.get<ServerRequest>("request");

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
				reply: new ServerReply(),
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
	 * Get the user account token for a local action call.
	 * It will check the options, context, and system user.
	 */
	protected getUserFromLocalFunctionContext(
		options: { user?: UserAccountToken | "system" | "context" },
		permission: Permission,
		isRouteSecure: boolean,
	): UserAccountToken | undefined {
		const hasSecurity = this.alepha.has(SecurityProvider);
		const fromOptions =
			typeof options.user === "object" ? options.user : undefined;

		if (!hasSecurity) {
			// system has no security, so we don't need to check it
			return fromOptions;
		}

		const type = typeof options.user === "string" ? options.user : undefined;

		let user: UserAccountToken | undefined;

		const fromContext = this.alepha.context.get<ServerRequest>("request")?.user;
		const fromSystem = this.alepha.state(
			"ServerSecurityProvider.localSystemUser",
		);

		if (type === "system") {
			user = fromSystem;
		} else if (type === "context") {
			user = fromContext;
		} else {
			user = fromOptions ?? fromSystem ?? fromContext;
		}

		if (!user) {
			if (isRouteSecure) {
				if (this.alepha.isTest()) {
					// in tests, we can return undefined user if route is not secured for now
					return {
						id: randomUUID(),
						name: "Test",
						roles: ["admin"],
					};
				}

				throw new UnauthorizedError(
					"User is required for calling this route locally",
				);
			} else {
				// if route is not secured, we can return undefined user
				return;
			}
		}

		const roles = user.roles ?? [];
		const securityProvider = this.alepha.get(SecurityProvider);
		const result = securityProvider.checkPermission(permission, ...roles);
		if (!result.isAuthorized) {
			throw new ForbiddenError(
				`Permission '${securityProvider.permissionToString(permission)}' is required for this route`,
			);
		}

		// create a new user object with ownership if needed
		return {
			...user,
			ownership: result.ownership,
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
	// testing
	localHandler: LocalHandler;
}

export type LocalHandler<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = (
	config?: ServerRequestConfigEntry<TConfig>,
	options?: ClientRequestOptions,
) => Promise<any>;
