import {
  $atom,
  $inject,
  $store,
  AlephaError,
  type Async,
  createPrimitive,
  type Infer,
  isTypeFile,
  type Middleware,
  type MiddlewareProvides,
  PipelineHandler,
  PipelinePrimitive,
  type PipelinePrimitiveOptions,
  type SchemaOutput,
  z,
} from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { KIND } from "alepha/internal";
import { $logger } from "alepha/logger";

import type { RouteMethod } from "../constants/routeMethods.ts";
import type { HttpError, HttpErrorClass } from "../errors/HttpError.ts";
import { InternalServerError } from "../errors/InternalServerError.ts";
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
 * Creates a server action primitive for defining type-safe HTTP endpoints.
 *
 * Server actions are the core building blocks for REST APIs in Alepha, providing declarative
 * HTTP endpoints with full type safety, automatic validation, and OpenAPI documentation.
 *
 * **Key Features**
 * - Full TypeScript inference for request/response types
 * - Automatic schema validation using Zod
 * - An explicit method and path on every action, no convention to remember
 * - Direct invocation (`run()`) or HTTP requests (`fetch()`)
 * - Built-in authentication and authorization support
 * - Automatic content-type handling (JSON, form-data, plain text)
 *
 * **URL Generation**
 *
 * **Important:** All `$action` paths are automatically prefixed with `/api`.
 *
 * ```ts
 * $action({ method: "GET", path: "/users" })     // → GET /api/users
 * $action({ method: "GET", path: "/users/:id" }) // → GET /api/users/:id
 * $action({ method: "POST", path: "/hello" })    // → POST /api/hello
 * ```
 *
 * This prefix is configurable via the `serverApiOptions` atom
 * (`alepha.store.mut(serverApiOptions, (o) => ({ ...o, prefix: "/v1" }))`).
 * `method` and `path` are both required: a read declares `method: "GET"`, and
 * renaming the property never moves the URL.
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
 *     method: "GET",
 *     path: "/users",
 *     schema: {
 *       query: z.object({
 *         page: z.number().default(1).optional(),
 *         limit: z.number().default(10).optional()
 *       }),
 *       response: z.object({
 *         users: z.array(z.object({
 *           id: z.text(),
 *           name: z.text(),
 *           email: z.text()
 *         })),
 *         total: z.number()
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
 *       body: z.object({
 *         name: z.text(),
 *         email: z.text({ format: "email" })
 *       }),
 *       response: z.object({ id: z.text(), name: z.text() })
 *     },
 *     handler: async ({ body }) => {
 *       return await this.userService.create(body);
 *     }
 *   });
 * }
 * ```
 */
export const $action = <
  TConfig extends RequestConfigSchema,
  const TUse extends readonly Middleware[] = [],
  const TErrors extends readonly HttpErrorClass[] | undefined = undefined,
>(
  options: ActionPrimitiveOptions<TConfig, TUse, TErrors>,
): ActionPrimitiveFn<TConfig, TErrors> => {
  const instance = createPrimitive(
    ActionPrimitive<TConfig, TErrors>,
    options as unknown as ActionPrimitiveOptions<
      TConfig,
      readonly Middleware[],
      TErrors
    >,
  );
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
  return Object.setPrototypeOf(fn, instance) as ActionPrimitiveFn<
    TConfig,
    TErrors
  >;
};

// ----------------------------------------------------------------------------------------------------------

export interface ActionPrimitiveOptions<
  TConfig extends RequestConfigSchema,
  TUse extends readonly Middleware[] = readonly Middleware[],
  TErrors extends readonly HttpErrorClass[] | undefined =
    | readonly HttpErrorClass[]
    | undefined,
>
  extends
    Omit<ServerRoute, "handler" | "path" | "schema" | "mapParams">,
    PipelinePrimitiveOptions {
  /**
   * Name of the action.
   *
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
   *   hello = $action({
   *     method: "GET",
   *     path: "/hello",
   *     handler: () => "Hello World",
   *   });
   * }
   *
   * // group = "users"
   * class MyOtherController {
   *   group = "users";
   *   list = $action({
   *     method: "GET",
   *     path: "/users",
   *     group: this.group,
   *     handler: () => [],
   *   });
   * }
   * ```
   */
  group?: string;

  /**
   * Pathname of the route, below the API prefix (`/api` by default). Path
   * variables are written `:name` and declared in `schema.params`.
   *
   * Required: the URL is part of the public contract, so it never derives
   * from the property name, which a rename would change silently.
   */
  path: string;

  /**
   * The route method. Required, with or without a body.
   *
   * `"GET"` for a read: it is the method the HTTP client caches (ETag) and
   * deduplicates, and a claim that the call changes nothing, since browsers,
   * proxies and the `tokens` cookie treat it that way.
   *
   * Wildcard methods are not supported for now. (e.g. "ALL", "ANY", etc.)
   */
  method: RouteMethod;

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
   * Middlewares wrapping the handler, outermost first. A middleware that
   * guarantees something (`$secure` guarantees a `user`) narrows the
   * handler's request type.
   */
  use?: TUse;

  /**
   * The errors this action answers with: `$error` constants or built-in
   * `HttpError` classes (`NotFoundError`). Setting it turns on strict mode.
   *
   * - Omitted: any `HttpError` the handler throws reaches the client with its
   *   status, as it always has.
   * - Set: an error matching a declared class by `instanceof` reaches the
   *   client with its status and `data`. Anything else the handler (or a
   *   service it calls) throws becomes a 500 `InternalServerError`, answered
   *   like any other crash, and a warning names the action and the
   *   undeclared class.
   * - `errors: []` is strict with nothing expected.
   *
   * Only what the handler throws is filtered. Request validation (400),
   * `$secure` (401/403), `$rateLimit` (429) and every other `use`
   * middleware sit outside the filter and always pass, and so does a 503 (a
   * timeout such as `DbTimeoutError`), which tells the caller to retry.
   *
   * ```ts
   * createProject = $action({
   *   method: "POST",
   *   path: "/projects",
   *   errors: [QuotaExceeded, NotFoundError],
   *   handler: async ({ body }) => this.projects.create(body),
   * });
   * ```
   */
  errors?: TErrors;

  /**
   * How long the action may run before it answers 503 with a `TimeoutError`.
   *
   * The deadline covers the `use` middlewares and the handler (a `$lock`
   * wait or a `$secure` key fetch counts), not the request body's upload nor
   * a streamed response body. When it passes, the action's signal aborts
   * with the `TimeoutError`, so the handler's outbound calls and queries stop
   * too, and the caller is answered at once.
   *
   * None by default: the `serverApiOptions` atom's `timeout` sets one for
   * every action, and `false` opts this one out of it. A timeout passes
   * strict mode (`errors`) as the 503 it is.
   *
   * ```ts
   * report = $action({
   *   method: "POST",
   *   path: "/reports",
   *   timeout: [10, "seconds"],
   *   handler: async () => this.reports.build(),
   * });
   * ```
   */
  timeout?: DurationLike | false;

  /**
   * Main route handler. This is where the route logic is implemented.
   */
  handler: ServerActionHandler<TConfig, TUse>;
}

// ----------------------------------------------------------------------------------------------------------

/**
 * Server API configuration atom.
 */
export const serverApiOptions = $atom({
  name: "alepha.server.api.options",
  schema: z.object({
    prefix: z.text({
      default: "/api",
      description: "Prefix for all API routes (e.g. $action).",
    }),
    timeout: z
      .integer()
      .describe(
        "Milliseconds every $action may run before it answers 503 (TimeoutError). Unset or 0: no timeout. An action's own `timeout` wins.",
      )
      .optional(),
  }),
  default: {
    prefix: "/api",
  },
});

export type ServerApiOptions = Infer<typeof serverApiOptions.schema>;

declare module "alepha" {
  interface State {
    [serverApiOptions.key]: ServerApiOptions;
  }
}

// ----------------------------------------------------------------------------------------------------------

export class ActionPrimitive<
  TConfig extends RequestConfigSchema,
  TErrors extends readonly HttpErrorClass[] | undefined =
    | readonly HttpErrorClass[]
    | undefined,
> extends PipelinePrimitive<
  ActionPrimitiveOptions<TConfig, readonly Middleware[], TErrors>
> {
  protected readonly log = $logger();

  /**
   * The handler composed with its `use` middlewares, the strict-mode filter
   * innermost: it wraps `options.handler` alone, so every middleware (and the
   * request validation that runs before the pipeline) stays outside it. One
   * wrapper serves the HTTP call and the local `run()` call alike.
   */
  public readonly handler = new PipelineHandler(
    this.filterDeclaredErrors(this.options.handler),
    this.options.use,
    (run) => this.withDeadline(run),
  );

  protected readonly settings = $store(serverApiOptions);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly httpClient = $inject(HttpClient);
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);

  protected onInit() {
    // Typed as required; this guards an untyped caller, whose action would
    // otherwise register at `/api/undefined`.
    if (!this.options.method || !this.options.path) {
      throw new AlephaError(
        `Action '${this.name}' must declare both 'method' and 'path'.`,
      );
    }
    if (this.options.disabled) {
      this.log.debug(
        `Action '${this.name}' is disabled. It won't be available in the API.`,
      );
      return;
    }
    this.serverRouterProvider.createRoute(this.route);
  }

  public get prefix() {
    return this.settings.prefix;
  }

  public get route(): ServerRoute {
    return {
      ...this.options,
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
    return this.options.method;
  }

  /**
   * Returns the path of the action, without the API prefix.
   */
  public get path(): string {
    return this.options.path;
  }

  public get schema(): TConfig | undefined {
    return this.options.schema;
  }

  /**
   * The declared errors, or `undefined` when the action is not strict.
   */
  public get errors(): TErrors | undefined {
    return this.options.errors;
  }

  /**
   * The timeout this action runs under: its own, else the `serverApiOptions`
   * default. `undefined` when there is none (`false` on the action, or no
   * default).
   */
  public get timeout(): DurationLike | undefined {
    const own = this.options.timeout;
    if (own === false) {
      return undefined;
    }
    return own ?? (this.settings.timeout || undefined);
  }

  /**
   * Run the composed pipeline under the action's deadline, when it has one.
   */
  protected withDeadline(run: () => any): any {
    const timeout = this.timeout;
    if (timeout === undefined) {
      return run();
    }
    return this.dateTime.deadline(run, timeout);
  }

  /**
   * Wrap the handler so that, in strict mode, only the declared errors
   * escape it unchanged. `errors !== undefined`, never its length:
   * `errors: []` is strict too.
   */
  protected filterDeclaredErrors(
    handler: (...args: any[]) => any,
  ): (...args: any[]) => any {
    const errors = this.options.errors;
    if (errors === undefined) {
      return handler;
    }

    return async (...args: any[]) => {
      try {
        return await handler(...args);
      } catch (error) {
        throw this.toDeclaredError(error, errors);
      }
    };
  }

  /**
   * What a strict action lets through for an error its handler threw: the
   * error itself when it is declared or a 503, else an `InternalServerError`
   * carrying it as `cause`.
   */
  protected toDeclaredError(
    error: unknown,
    errors: readonly HttpErrorClass[],
  ): unknown {
    if (errors.some((cls) => error instanceof cls)) {
      return error;
    }

    const unavailable = this.findUnavailable(error);
    if (unavailable) {
      return unavailable;
    }

    const name = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);

    this.log.warn(
      `'${this.name}' threw ${name}, which it does not declare: it answers ` +
        `a 500. Add ${name} to its errors, or stop throwing it.`,
      { action: this.name, error: name, message },
    );

    return new InternalServerError(`${name}: ${message}`, { cause: error });
  }

  /**
   * A 503 in the error or its cause chain: a timeout (`DbTimeoutError`,
   * which drizzle may wrap) or anything else telling the caller to retry.
   * It is never a contract violation, so strict mode passes it through.
   */
  protected findUnavailable(error: unknown): Error | undefined {
    let current: unknown = error;

    // Bounded: a cause chain looping on itself must not hang the error path.
    for (let depth = 0; depth < 10; depth++) {
      if (!(current instanceof Error)) {
        return undefined;
      }
      if ((current as { status?: unknown }).status === 503) {
        return current;
      }
      current = current.cause;
    }

    return undefined;
  }

  public getBodyContentType(): string | undefined {
    if (this.options.schema?.body) {
      // TODO: move to `alepha.server.multipart` module ?
      if (isMultipart(this.options)) {
        return "multipart/form-data";
      }

      if (z.schema.isString(this.options.schema.body)) {
        // if body is a string, we assume it's plain text
        return "text/plain";
      }

      if (
        z.schema.isObject(this.options.schema.body) ||
        z.schema.isArray(this.options.schema.body) ||
        z.schema.isRecord(this.options.schema.body)
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
    const url = new URL(`http://localhost${this.path}`);

    // The caller's address, when this call happens inside one.
    //
    // A nested invocation (`/api/_batch`, an SSR loader) has no socket of its
    // own, so `ip` used to be undefined and every such call keyed the rate
    // limiter on `ip:unknown` - one bucket shared by every client in the
    // world, and no client ever limited per address. The HTTP request that
    // is actually paying for this work is on an ancestor context layer;
    // inherit its address so the budget comes out of the right bucket.
    //
    // Untracked (#E78): the address keys a rate limit and never reaches a
    // page, so an in-process call from a loader must not make it personal.
    const parentIp = this.alepha.store.getUntracked("alepha.http.request")?.ip;

    const serverActionRequest: Partial<ServerRequest> = {
      method,
      url,
      body,
      params,
      query,
      headers,
      reply,
      ip: parentIp,
      metadata: {
        routePath: this.route.path,
        routeMethod: this.route.method,
      },
    };

    const eventData: {
      action: ActionPrimitive<TConfig, TErrors>;
      request: ServerRequest;
      options: ClientRequestOptions;
      context?: Record<string, any>;
    } = {
      action: this,
      request: serverActionRequest as ServerRequest,
      options,
    };

    await this.alepha.events.emit("action:request:before", eventData as any);

    if (serverActionRequest.reply?.body) {
      return serverActionRequest.reply.body as ClientRequestResponse<TConfig>;
    }

    const executeHandler = async (): Promise<
      ClientRequestResponse<TConfig>
    > => {
      if (serverActionRequest.query && this.options.schema?.query) {
        serverActionRequest.query = this.alepha.codec.encode(
          this.options.schema.query,
          serverActionRequest.query,
        );
      }

      if (serverActionRequest.headers && this.options.schema?.headers) {
        // Per-key encode (matches the server-side decode pattern in
        // ServerRouterProvider.validateRequest): coerces declared headers via
        // the schema, leaves undeclared ones untouched. Schema keys are
        // lowercased to match Node's incoming header convention.
        const schemaHeaders = this.options.schema.headers;
        const headers = serverActionRequest.headers as Record<string, unknown>;
        for (const key of Object.keys(z.schema.shape(schemaHeaders))) {
          const lcKey = key.toLowerCase();
          if (headers[lcKey] !== undefined) {
            headers[lcKey] = this.alepha.codec.encode(
              z.schema.shape(schemaHeaders)[key],
              headers[lcKey],
            );
          }
        }
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

      await this.alepha.events.emit("action:response:after", {
        action: this,
        request: serverActionRequest as ServerRequest,
        options,
        response,
      });

      return response;
    };

    // Always fork to isolate each .run() call in its own ALS context.
    // The synthetic action request is separate from any real HTTP request.
    // Hook fork data (e.g. user atom) is merged into the context.
    const forkData: Record<string, any> = {
      "alepha.action.request": serverActionRequest,
      ...eventData.context,
    };

    return this.alepha.fork(executeHandler, forkData);
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
      action: this as ActionPrimitive<TConfig>,
      config,
      options,
    });
  }
}

export interface ActionPrimitiveFn<
  TConfig extends RequestConfigSchema,
  TErrors extends readonly HttpErrorClass[] | undefined =
    | readonly HttpErrorClass[]
    | undefined,
> extends ActionPrimitive<TConfig, TErrors> {
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
  body: SchemaOutput<TConfig["body"], undefined>;

  params: SchemaOutput<TConfig["params"], undefined>;

  headers?: SchemaOutput<TConfig["headers"], Record<string, string>>;

  query?: Partial<SchemaOutput<TConfig["query"], Record<string, string>>>;
};

export interface ClientRequestOptions extends FetchOptions {
  /**
   * Standard request fetch options.
   */
  request?: RequestInit;

  /**
   * Add query parameters to the request URL. They will be merged with any query params defined in the action schema.
   * This is useful for adding dynamic query params at runtime.
   */
  query?: Record<string, string | number | boolean>;
}

export type ClientRequestResponse<TConfig extends RequestConfigSchema> =
  SchemaOutput<TConfig["response"], any>;

/**
 * The errors a client of a strict action may receive, as a union of
 * instances: its declared errors plus the `InternalServerError` anything
 * else becomes. `HttpError` for an action that declares no `errors`.
 *
 * TypeScript has no place for a rejection type on a `Promise`, so this is
 * read where it is needed rather than carried by the call:
 *
 * ```ts
 * const handle = (error: ActionErrors<typeof api.createProject>) => {
 *   if (error instanceof QuotaExceeded) return error.data.limit;
 * };
 * ```
 */
export type ActionErrors<A> =
  A extends ActionPrimitive<any, infer E>
    ? E extends readonly HttpErrorClass[]
      ? InstanceType<E[number]> | InternalServerError
      : HttpError
    : never;

/**
 * Specific handler for server actions.
 */
export type ServerActionHandler<
  TConfig extends RequestConfigSchema = RequestConfigSchema,
  TUse extends readonly Middleware[] = readonly Middleware[],
> = (
  request: ServerActionRequest<TConfig> & MiddlewareProvides<TUse>,
) => Async<ServerResponseBody<TConfig>>;

/**
 * Server Action Request Interface
 *
 * Can be extended with module augmentation to add custom properties (like `user` in Server Security).
 *
 * This is NOT Server Request, but a specific type for actions.
 */
export interface ServerActionRequest<
  TConfig extends RequestConfigSchema,
> extends ServerRequest<TConfig> {}
