import {
	$env,
	$inject,
	type Async,
	createDescriptor,
	Descriptor,
	isTypeFile,
	KIND,
	type Static,
	type TSchema,
	t,
} from "@alepha/core";
import { $logger } from "@alepha/logger";
import type { RouteMethod } from "../constants/routeMethods.ts";
import { isMultipart } from "../helpers/isMultipart.ts";
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
 * Creates a server action descriptor for defining type-safe HTTP endpoints.
 *
 * Server actions are the core building blocks for REST APIs in the Alepha framework. They provide
 * a declarative way to define HTTP endpoints with full TypeScript type safety, automatic schema
 * validation, and integrated security features. Actions automatically handle routing, request
 * parsing, response serialization, and OpenAPI documentation generation.
 *
 * **Key Features**
 *
 * - **Type Safety**: Full TypeScript inference for request/response types
 * - **Schema Validation**: Automatic validation using TypeBox schemas
 * - **Auto-routing**: Convention-based URL generation with customizable paths
 * - **Multiple Invocation**: Call directly (`run()`) or via HTTP (`fetch()`)
 * - **OpenAPI Integration**: Automatic documentation generation
 * - **Security Integration**: Built-in authentication and authorization support
 * - **Content Type Detection**: Automatic handling of JSON, form-data, and plain text
 *
 * **URL Generation**
 *
 * By default, actions are prefixed with `/api` (configurable via `SERVER_API_PREFIX`):
 * - Property name becomes the endpoint path
 * - Path parameters are automatically detected from schema
 * - HTTP method defaults to GET, or POST if body schema is provided
 *
 * **Use Cases**
 *
 * Perfect for building robust REST APIs:
 * - CRUD operations with full type safety
 * - File upload and download endpoints
 * - Real-time data processing APIs
 * - Integration with external services
 * - Microservice communication
 * - Admin and management interfaces
 *
 * @example
 * **Basic CRUD operations:**
 * ```ts
 * import { $action } from "alepha/server";
 * import { t } from "alepha";
 *
 * class UserController {
 *
 *   getUsers = $action({
 *     path: "/users",
 *     description: "Retrieve all users with pagination",
 *     schema: {
 *       query: t.object({
 *         page: t.optional(t.number({ default: 1 })),
 *         limit: t.optional(t.number({ default: 10, maximum: 100 })),
 *         search: t.optional(t.string())
 *       }),
 *       response: t.object({
 *         users: t.array(t.object({
 *           id: t.string(),
 *           name: t.string(),
 *           email: t.string(),
 *           createdAt: t.datetime()
 *         })),
 *         total: t.number(),
 *         hasMore: t.boolean()
 *       })
 *     },
 *     handler: async ({ query }) => {
 *       const { page, limit, search } = query;
 *       const users = await this.userService.findUsers({ page, limit, search });
 *
 *       return {
 *         users: users.items,
 *         total: users.total,
 *         hasMore: (page * limit) < users.total
 *       };
 *     }
 *   });
 *
 *   createUser = $action({
 *     method: "POST",
 *     path: "/users",
 *     description: "Create a new user account",
 *     schema: {
 *       body: t.object({
 *         name: t.string({ minLength: 2, maxLength: 100 }),
 *         email: t.string({ format: "email" }),
 *         password: t.string({ minLength: 8 }),
 *         role: t.optional(t.enum(["user", "admin"]))
 *       }),
 *       response: t.object({
 *         id: t.string(),
 *         name: t.string(),
 *         email: t.string(),
 *         role: t.string(),
 *         createdAt: t.datetime()
 *       })
 *     },
 *     handler: async ({ body }) => {
 *       // Password validation and hashing
 *       await this.authService.validatePassword(body.password);
 *       const hashedPassword = await this.authService.hashPassword(body.password);
 *
 *       // Create user with default role
 *       const user = await this.userService.create({
 *         ...body,
 *         password: hashedPassword,
 *         role: body.role || "user"
 *       });
 *
 *       // Return user without password
 *       const { password, ...publicUser } = user;
 *       return publicUser;
 *     }
 *   });
 *
 *   getUser = $action({
 *     path: "/users/:id",
 *     description: "Retrieve user by ID",
 *     schema: {
 *       params: t.object({
 *         id: t.string()
 *       }),
 *       response: t.object({
 *         id: t.string(),
 *         name: t.string(),
 *         email: t.string(),
 *         role: t.string(),
 *         profile: t.optional(t.object({
 *           bio: t.string(),
 *           avatar: t.string({ format: "uri" }),
 *           location: t.string()
 *         }))
 *       })
 *     },
 *     handler: async ({ params }) => {
 *       const user = await this.userService.findById(params.id);
 *       if (!user) {
 *         throw new Error(`User not found: ${params.id}`);
 *       }
 *       return user;
 *     }
 *   });
 *
 *   updateUser = $action({
 *     method: "PUT",
 *     path: "/users/:id",
 *     description: "Update user information",
 *     schema: {
 *       params: t.object({ id: t.string() }),
 *       body: t.object({
 *         name: t.optional(t.string({ minLength: 2 })),
 *         email: t.optional(t.string({ format: "email" })),
 *         profile: t.optional(t.object({
 *           bio: t.optional(t.string()),
 *           avatar: t.optional(t.string({ format: "uri" })),
 *           location: t.optional(t.string())
 *         }))
 *       }),
 *       response: t.object({
 *         id: t.string(),
 *         name: t.string(),
 *         email: t.string(),
 *         updatedAt: t.datetime()
 *       })
 *     },
 *     handler: async ({ params, body }) => {
 *       const updatedUser = await this.userService.update(params.id, body);
 *       return updatedUser;
 *     }
 *   });
 * }
 * ```
 *
 * **Important Notes**:
 * - Actions are automatically registered with the HTTP server when the service is initialized
 * - Use `run()` for direct invocation (testing, internal calls, or remote services)
 * - Use `fetch()` for explicit HTTP requests (client-side, external services)
 * - Schema validation occurs automatically for all requests and responses
 * - Path parameters are automatically extracted from schema definitions
 * - Content-Type headers are automatically set based on schema types
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
			...(this.options as any), // TODO: fix schema.header mapping
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
			if (isMultipart(this.options)) {
				return "multipart/form-data";
			}

			if (t.schema.isString(this.options.schema.body)) {
				// if body is a string, we assume it's plain text
				return "text/plain";
			}

			if (
				t.schema.isObject(this.options.schema.body) ||
				t.schema.isArray(this.options.schema.body) ||
				t.schema.isRecord(this.options.schema.body)
			)
				// if body is an object or array, we assume it's JSON
				return "application/json";
		}
	}

	/**
	 * Call the action handler directly.
	 * There is no HTTP layer involved.
	 */
	public async run(
		config?: ClientRequestEntry<TConfig>,
		options: ClientRequestOptions = {}, // most of the options are ignored here
	): Promise<ClientRequestResponse<TConfig>> {
		const handler = this.options.handler;
		const {
			body,
			params = {},
			query = {},
			headers = {},
		} = (config ?? {}) as ClientRequestEntryContainer<RequestConfigSchema>;
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

		await this.alepha.events.emit("action:onRequest", {
			action: this,
			request: serverActionRequest as ServerRequest,
			options,
		});

		if (serverActionRequest.reply?.body) {
			return serverActionRequest.reply.body as ClientRequestResponse<TConfig>;
		}

		this.serverRouterProvider.validateRequest(
			this.options,
			serverActionRequest as ServerRequest,
		);

		let response: any = await handler(
			serverActionRequest as ServerActionRequest<TConfig>,
		);

		// we validate response just to remove undeclared properties from response
		if (
			this.options.schema?.response &&
			// skip validation if response is expected as file
			!isTypeFile(this.options.schema.response)
		) {
			response = this.alepha.parse(this.options.schema.response, response);
		}

		await this.alepha.events.emit("action:onResponse", {
			action: this,
			request: serverActionRequest as ServerRequest,
			options,
			response,
		});

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
