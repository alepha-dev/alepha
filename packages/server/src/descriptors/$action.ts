import { randomUUID } from "node:crypto";
import {
	$env,
	$inject,
	createDescriptor,
	Descriptor,
	isFileLike,
	isTypeFile,
	KIND,
	type Static,
	type TSchema,
	t,
} from "@alepha/core";
import {
	type Permission,
	SecurityProvider,
	type UserAccountToken,
} from "@alepha/security";
import type { RouteMethod } from "../constants/routeMethods.ts";
import { ForbiddenError } from "../errors/ForbiddenError.ts";
import { UnauthorizedError } from "../errors/UnauthorizedError.ts";
import { ServerReply } from "../helpers/ServerReply.ts";
import type {
	RequestConfigSchema,
	ServerHandler,
	ServerRequest,
	ServerRequestConfigEntry,
	ServerRoute,
} from "../interfaces/index.ts";
import { ServerProvider } from "../providers/platforms/ServerProvider.ts";
import { ServerRouterProvider } from "../providers/ServerRouterProvider.ts";
import {
	type FetchOptions,
	type FetchResponse,
	HttpClient,
} from "../services/HttpClient.ts";

/**
 * Create an action endpoint.
 *
 * By default, all actions are prefixed by `/api`.
 * If `name` is not provided, the action will be named after the property key.
 * If `path` is not provided, the action will be named after the function name.
 *
 * @example
 * ```ts
 * class MyController {
 *   hello = $action({
 *     handler: () => "Hello World",
 *   })
 * }
 * // GET /api/hello -> "Hello World"
 * ```
 */
export const $action = <TConfig extends RequestConfigSchema>(
	options: ActionDescriptorOptions<TConfig>,
): ActionDescriptor<TConfig> => {
	return createDescriptor(ActionDescriptor<TConfig>, options);
};

// ----------------------------------------------------------------------------------------------------------

export interface ActionDescriptorOptions<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> extends Omit<ServerRoute, "handler" | "path" | "schema"> {
	/**
	 * Name of the action.
	 *
	 * - It will be used to generate the route path if `path` is not provided.
	 * - It will be used to generate the permission name if `security` is enabled.
	 */
	name?: string;

	/**
	 * Group actions together.
	 *
	 * - If not provided, the service name containing the route will be used.
	 * - It will be used as Tag for documentation purposes.
	 * - It will be used for permission name generation if `security` is enabled.
	 *
	 * @example
	 * ```ts
	 * // group = "MyController"
	 * class MyController {
	 * 	hello = $action({ handler: () => "Hello World" });
	 * }
	 *
	 * // group = "users"
	 * class MyOtherController {
	 *   group = "users";
	 *   a1 = $action({ handler: () => "Action 1", group: this.group });
	 *   a2 = $action({ handler: () => "Action 2", group: this.group });
	 * }
	 * ```
	 */
	group?: string;

	/**
	 * Pathname of the route. If not provided, property key is used.
	 */
	path?: string;

	/**
	 * The route method.
	 *
	 * - If not provided, it will be set to "GET" by default.
	 * - If not provider and a body is provided, it will be set to "POST".
	 *
	 * Wildcard methods are not supported for now. (e.g. "ALL", "ANY", etc.)
	 */
	method?: RouteMethod;

	/**
	 * The config schema of the route.
	 * - body: The request body schema.
	 * - params: Path variables schema.
	 * - query: The request query-params schema.
	 * - response: The response schema.
	 */
	schema?: TConfig;

	/**
	 * A short description of the action. Used for documentation purposes.
	 */
	description?: string;

	/**
	 * Disable the route. Useful with env variables do disable one specific route.
	 */
	disabled?: boolean;

	/**
	 * Main route handler. This is where the route logic is implemented.
	 */
	handler: ServerHandler<TConfig>;

	/**
	 * Short description of the route.
	 *
	 * TODO: move to Swagger plugin.
	 */
	summary?: string;

	/**
	 * Mark the route as private.
	 *
	 * - It won't be exposed in the API documentation.
	 * - It won't be exposed in _links.
	 *
	 * @deprecated - use `$route()` instead.
	 */
	internal?: boolean;

	/**
	 * If false, disabled the security check for this route.
	 *
	 * @deprecated - use `secure` instead.
	 */
	security?: boolean;
}

// ----------------------------------------------------------------------------------------------------------

const envSchema = t.object({
	SERVER_API_PREFIX: t.string({
		description: "Prefix for all API routes (e.g. $action).",
		default: "/api",
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

export class ActionDescriptor<
	TConfig extends RequestConfigSchema,
> extends Descriptor<ActionDescriptorOptions<TConfig>> {
	protected readonly env = $env(envSchema);
	protected readonly httpClient = $inject(HttpClient);
	protected readonly serverProvider = $inject(ServerProvider);
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);

	public get prefix() {
		return this.env.SERVER_API_PREFIX;
	}

	public get route(): ServerAction {
		return {
			...this.options,
			method: this.method,
			path: this.path,
			action: this,
		};
	}

	/**
	 * Returns the name of the action.
	 */
	public get name(): string {
		return this.options.name || this.config.propertyKey;
	}

	/**
	 * Returns the group of the action. (e.g. "orders", "admin", etc.)
	 */
	public get group(): string {
		return this.options.group || this.config.service.name;
	}

	/**
	 * Returns the HTTP method of the action.
	 */
	public get method(): RouteMethod {
		return this.options.method || (this.options.schema?.body ? "POST" : "GET");
	}

	/**
	 * Returns the path of the action.
	 *
	 * Path is prefixed by `/api` by default.
	 */
	public get path(): string {
		return this.options.path || this.config.propertyKey;
	}

	/**
	 * Returns the security permission of the action.
	 *
	 * TODO: big rework of how we handle permissions of actions.
	 */
	public get permission(): Permission {
		return {
			group: this.group,
			name: this.name,
			description: this.options.description,
			method: this.method,
		};
	}

	public getBodyContentType(): string | undefined {
		if (this.options.schema?.body) {
			// TODO: move to `alepha.server.multipart` module ?
			for (const key in this.options.schema.body.properties) {
				if (
					this.options.schema.body.properties[key].type === "string" &&
					this.options.schema.body.properties[key].format === "binary"
				) {
					return "multipart/form-data";
				}
			}

			return "application/json";
		}
	}

	/**
	 * Call the action.
	 *
	 * - If the action is detected locally, it will be executed directly.
	 * - If the action is not detected locally, it will be fetched from the server.
	 *
	 * > Note: Automatic remote detection requires module `alepha.server.links`.
	 */
	public async run(
		config: ClientRequestEntry<TConfig>,
		options: ClientRequestOptions = {},
	): Promise<ClientRequestResponse<TConfig>> {
		const request = this.alepha.context.get<ServerRequest>("request");

		// TODO: hook - "local:onRequest" ?

		const handler = this.options.handler;
		const permission = this.permission;
		const security = !!this.options.secure || this.options.security !== false;

		const user = this.getUserFromLocalFunctionContext(
			options,
			permission,
			security,
		);

		const {
			body,
			params = {},
			query = {},
			headers = {},
		} = config as ClientRequestEntryContainer<RequestConfigSchema>;

		const url = new URL(`http://localhost${this.path ?? ""}`);

		const serverActionRequest: Partial<ServerRequest> = {
			...request,
			...options,
			method: this.method,
			url,
			body,
			params,
			query,
			headers,
			reply: new ServerReply(),
			metadata: {},
			raw: {},
			user,
		};

		this.serverRouterProvider.validateRequest(
			this.options,
			serverActionRequest as ServerRequest,
		);

		const response = await handler(serverActionRequest as ServerRequest);

		if (this.options.schema?.response) {
			if (isTypeFile(this.options.schema.response) && isFileLike(response)) {
				return response;
			}

			return this.alepha.parse<any>(this.options.schema?.response, response);
		}

		return response;
	}

	/**
	 * Works like `run`, but always fetches (http request) the route.
	 */
	public fetch(
		config?: ClientRequestEntry<TConfig>,
		options?: ClientRequestOptions,
	): Promise<FetchResponse<ClientRequestResponse<TConfig>>> {
		return this.httpClient.fetchAction({
			host: this.serverProvider.hostname, // that's the trick, we just use the server hostname
			action: this,
			config,
			options,
		});
	}

	// -------------

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
		): Promise<any> => {};
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

$action[KIND] = ActionDescriptor;

// ----------------------------------------------------------------------------------------------------------

export type ClientRequestEntry<
	TConfig extends RequestConfigSchema,
	T = ClientRequestEntryContainer<TConfig>,
> = {
	[K in keyof T as T[K] extends undefined ? never : K]: T[K];
};

export type ClientRequestEntryContainer<TConfig extends RequestConfigSchema> = {
	body: TConfig["body"] extends TSchema ? Static<TConfig["body"]> : undefined;

	params: TConfig["params"] extends TSchema
		? Static<TConfig["params"]>
		: undefined;

	headers?: TConfig["headers"] extends TSchema
		? Static<TConfig["headers"]>
		: undefined;

	query?: TConfig["query"] extends TSchema
		? Partial<Static<TConfig["query"]>>
		: undefined;
};

export interface ClientRequestOptions extends FetchOptions {
	/**
	 * Forward user from the previous request.
	 * If "system", use system user. @see {ServerSecurityProvider.localSystemUser}
	 * If "context", use the user from the current context (e.g. request).
	 *
	 * @default "system" is provided, else "context" is used.
	 */
	user?: UserAccountToken | "system" | "context";

	/**
	 * Standard request fetch options.
	 */
	request?: RequestInit;
}

export type ClientRequestResponse<TConfig extends RequestConfigSchema> =
	TConfig["response"] extends TSchema ? Static<TConfig["response"]> : any;

export interface ServerAction extends ServerRoute {
	action: ActionDescriptor<RequestConfigSchema>;
}

export function isServerAction(route: any): route is ServerAction {
	return (
		typeof route === "object" &&
		"action" in route &&
		route.action instanceof ActionDescriptor
	);
}
