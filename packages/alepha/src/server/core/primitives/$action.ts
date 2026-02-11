import {
  $env,
  $inject,
  AlephaError,
  type Async,
  createPrimitive,
  isTypeFile,
  KIND,
  PipelinePrimitive,
  type PipelinePrimitiveOptions,
  type Static,
  type TObject,
  type TSchema,
  t,
} from "alepha";
import { $logger } from "alepha/logger";
import type { RouteMethod } from "../constants/routeMethods.ts";
import { isMultipart } from "../helpers/isMultipart.ts";
import { ServerReply } from "../helpers/ServerReply.ts";
import type {
  RequestConfigSchema,
  ServerRequest,
  ServerResponseBody,
  ServerRoute,
  TRequestBody,
} from "../interfaces/ServerRequest.ts";
import { ServerProvider } from "../providers/ServerProvider.ts";
import { ServerRouterProvider } from "../providers/ServerRouterProvider.ts";
import {
  type FetchOptions,
  type FetchResponse,
  HttpClient,
} from "../services/HttpClient.ts";

/**
 * Creates a server action primitive for defining type-safe HTTP endpoints.
 *
 * Server actions are the core building blocks for REST APIs in Alepha, providing declarative
 * HTTP endpoints with full type safety, automatic validation, and OpenAPI documentation.
 *
 * **Key Features**
 * - Full TypeScript inference for request/response types
 * - Automatic schema validation using TypeBox
 * - Convention-based URL generation with customizable paths
 * - Direct invocation (`run()`) or HTTP requests (`fetch()`)
 * - Built-in authentication and authorization support
 * - Automatic content-type handling (JSON, form-data, plain text)
 *
 * **URL Generation**
 *
 * **Important:** All `$action` paths are automatically prefixed with `/api`.
 *
 * ```ts
 * $action({ path: "/users" })     // → GET /api/users
 * $action({ path: "/users/:id" }) // → GET /api/users/:id
 * $action({ path: "/hello" })     // → GET /api/hello
 * ```
 *
 * This prefix is configurable via the `SERVER_API_PREFIX` environment variable.
 * HTTP method defaults to GET, or POST if body schema is provided.
 *
 * **Common Use Cases**
 * - CRUD operations with type safety
 * - File upload and download endpoints
 * - Microservice communication
 *
 * @example
 * ```ts
 * class UserController {
 *   getUsers = $action({
 *     path: "/users",
 *     schema: {
 *       query: t.object({
 *         page: t.optional(t.number({ default: 1 })),
 *         limit: t.optional(t.number({ default: 10 }))
 *       }),
 *       response: t.object({
 *         users: t.array(t.object({
 *           id: t.text(),
 *           name: t.text(),
 *           email: t.text()
 *         })),
 *         total: t.number()
 *       })
 *     },
 *     handler: async ({ query }) => {
 *       const users = await this.userService.findUsers(query);
 *       return { users: users.items, total: users.total };
 *     }
 *   });
 *
 *   createUser = $action({
 *     method: "POST",
 *     path: "/users",
 *     schema: {
 *       body: t.object({
 *         name: t.text(),
 *         email: t.text({ format: "email" })
 *       }),
 *       response: t.object({ id: t.text(), name: t.text() })
 *     },
 *     handler: async ({ body }) => {
 *       return await this.userService.create(body);
 *     }
 *   });
 * }
 * ```
 */
export const $action = <TConfig extends RequestConfigSchema>(
  options: ActionPrimitiveOptions<TConfig>,
): ActionPrimitiveFn<TConfig> => {
  const instance = createPrimitive(ActionPrimitive<TConfig>, options);
  const fn = (
    config?: ClientRequestEntry<TConfig>,
    options?: ClientRequestOptions,
  ) => {
    return instance.run(config, options);
  };
  Object.defineProperty(fn, "name", {
    get(): string {
      return instance.options.name || instance.config.propertyKey;
    },
  });
  return Object.setPrototypeOf(fn, instance) as ActionPrimitiveFn<TConfig>;
};

// ----------------------------------------------------------------------------------------------------------

export interface ActionPrimitiveOptions<TConfig extends RequestConfigSchema>
  extends Omit<ServerRoute, "handler" | "path" | "schema" | "mapParams">,
    PipelinePrimitiveOptions {
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
   * Disable the route. Useful with env variables to disable one specific route.
   * Route won't be available in the API nor locally.
   */
  disabled?: boolean;

  /**
   * Main route handler. This is where the route logic is implemented.
   */
  handler: ServerActionHandler<TConfig>;
}

// ----------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  SERVER_API_PREFIX: t.text({
    description: "Prefix for all API routes (e.g. $action).",
    default: "/api",
  }),
});

export class ActionPrimitive<
  TConfig extends RequestConfigSchema,
> extends PipelinePrimitive<ActionPrimitiveOptions<TConfig>> {
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
      handler: this.handler,
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
    if (this.options.disabled) {
      throw new AlephaError(`Action '${this.name}' is disabled.`);
    }
    const handler = this.handler.run.bind(this.handler);
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
    };

    await this.alepha.events.emit("action:onRequest", {
      action: this,
      request: serverActionRequest as ServerRequest,
      options,
    });

    if (serverActionRequest.reply?.body) {
      return serverActionRequest.reply.body as ClientRequestResponse<TConfig>;
    }

    if (serverActionRequest.query && this.options.schema?.query) {
      serverActionRequest.query = this.alepha.codec.encode(
        this.options.schema.query,
        serverActionRequest.query,
      );
    }

    if (serverActionRequest.headers && this.options.schema?.headers) {
      serverActionRequest.headers = this.alepha.codec.encode(
        this.options.schema.headers,
        serverActionRequest.headers,
      ) as Record<string, any>;
    }

    if (serverActionRequest.body && this.options.schema?.body) {
      serverActionRequest.body = this.alepha.codec.encode(
        this.options.schema.body,
        serverActionRequest.body,
      ) as unknown;
    }

    if (serverActionRequest.params && this.options.schema?.params) {
      serverActionRequest.params = this.alepha.codec.encode(
        this.options.schema.params,
        serverActionRequest.params,
      ) as Record<string, any>;
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
      response = this.alepha.codec.validate(
        this.options.schema.response,
        response,
      );
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

export interface ActionPrimitiveFn<TConfig extends RequestConfigSchema>
  extends ActionPrimitive<TConfig> {
  (
    config?: ClientRequestEntry<TConfig>,
    options?: ClientRequestOptions,
  ): Promise<ClientRequestResponse<TConfig>>;
}

$action[KIND] = ActionPrimitive;

// ----------------------------------------------------------------------------------------------------------

export type ClientRequestEntry<
  TConfig extends RequestConfigSchema,
  T = ClientRequestEntryContainer<TConfig>,
> = {
  [K in keyof T as T[K] extends undefined ? never : K]: T[K];
};

export type ClientRequestEntryContainer<TConfig extends RequestConfigSchema> = {
  body: TConfig["body"] extends TRequestBody
    ? Static<TConfig["body"]>
    : undefined;

  params: TConfig["params"] extends TObject
    ? Static<TConfig["params"]>
    : undefined;

  headers?: TConfig["headers"] extends TObject
    ? Static<TConfig["headers"]>
    : Record<string, string>;

  query?: TConfig["query"] extends TObject
    ? Partial<Static<TConfig["query"]>>
    : Record<string, string>;
};

export interface ClientRequestOptions extends FetchOptions {
  /**
   * Standard request fetch options.
   */
  request?: RequestInit;

  query?: Record<string, string | number | boolean>;
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
