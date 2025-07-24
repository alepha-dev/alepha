import {
	$env,
	$inject,
	$logger,
	type Async,
	createDescriptor,
	Descriptor,
	isTypeFile,
	KIND,
	type Static,
	type TSchema,
	t,
} from "@alepha/core";
import type { UserAccountToken } from "@alepha/security";
import type { RouteMethod } from "../constants/routeMethods.ts";
import { ServerReply } from "../helpers/ServerReply.ts";
import type {
	RequestConfigSchema,
	ServerRequest,
	ServerResponseBody,
	ServerRoute,
} from "../interfaces/ServerRequest.ts";
import { ServerProvider } from "../providers/ServerProvider.ts";
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

export interface ActionDescriptorOptions<TConfig extends RequestConfigSchema>
	extends Omit<ServerRoute, "handler" | "path" | "schema" | "mapParams"> {
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
	 * Route won't be available in the API but can still be called locally!
	 */
	disabled?: boolean;

	/**
	 * Main route handler. This is where the route logic is implemented.
	 */
	handler: ServerActionHandler<TConfig>;
}

// ----------------------------------------------------------------------------------------------------------

const envSchema = t.object({
	SERVER_API_PREFIX: t.string({
		description: "Prefix for all API routes (e.g. $action).",
		default: "/api",
	}),
});

export class ActionDescriptor<
	TConfig extends RequestConfigSchema,
> extends Descriptor<ActionDescriptorOptions<TConfig>> {
	protected readonly log = $logger();
	protected readonly env = $env(envSchema);
	protected readonly httpClient = $inject(HttpClient);
	protected readonly serverProvider = $inject(ServerProvider);
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);

	protected onInit() {
		if (this.options.disabled) {
			this.log.debug(
				`Action '${this.name}' is disabled. It won't be available in the API.`,
			);
			return;
		}
		this.serverRouterProvider.createRoute(this.route);
	}

	public get prefix() {
		return this.env.SERVER_API_PREFIX;
	}

	public get route(): ServerRoute {
		return {
			...this.options,
			method: this.method,
			path: `${this.prefix}${this.path}`,
		} as ServerRoute;
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
		if (this.options.path) {
			return this.options.path;
		}

		let path = `/${this.name}`;

		if (this.options.schema?.params) {
			for (const [key] of Object.entries(
				this.options.schema.params.properties,
			)) {
				path += `/:${key}`;
			}
		}

		return path;
	}

	public get schema(): TConfig | undefined {
		return this.options.schema;
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

			if (this.options.schema.body.type === "string") {
				// if body is a string, we assume it's plain text
				return "text/plain";
			}

			if (
				this.options.schema.body.type === "object" ||
				this.options.schema.body.type === "array"
			) {
				// if body is an object or array, we assume it's JSON
				return "application/json";
			}
		}
	}

	/**
	 * Call the action handler directly.
	 * There is no HTTP layer involved.
	 */
	public async run(
		config: ClientRequestEntry<TConfig>,
		options: ClientRequestOptions = {}, // most of the options are ignored here
	): Promise<ClientRequestResponse<TConfig>> {
		const handler = this.options.handler;
		const {
			body,
			params = {},
			query = {},
			headers = {},
		} = config as ClientRequestEntryContainer<RequestConfigSchema>;
		const reply = new ServerReply();
		const method = this.method;

		// we use localhost as the base URL for the action
		const url = new URL(`http://localhost${this.path ?? ""}`);

		const serverActionRequest: Partial<ServerRequest> = {
			method,
			url,
			body,
			params,
			query,
			headers,
			reply,
			metadata: {},
			raw: {},
		};

		await this.alepha.emit("action:onRequest", {
			action: this,
			request: serverActionRequest as ServerRequest,
			options,
		});

		this.serverRouterProvider.validateRequest(
			this.options,
			serverActionRequest as ServerRequest,
		);

		const response = await handler(
			serverActionRequest as ServerActionRequest<TConfig>,
		);

		// we validate response just to remove undeclared properties from response
		if (
			this.options.schema?.response &&
			// skip validation if response is expected as file
			!isTypeFile(this.options.schema.response)
		) {
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

/**
 * Specific handler for server actions.
 */
export type ServerActionHandler<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = (
	request: ServerActionRequest<TConfig>,
) => Async<ServerResponseBody<TConfig>>;

/**
 * Server Action Request Interface
 *
 * Can be extended with module augmentation to add custom properties (like `user` in Server Security).
 *
 * This is NOT Server Request, but a specific type for actions.
 */
export interface ServerActionRequest<TConfig extends RequestConfigSchema>
	extends ServerRequest<TConfig> {}
