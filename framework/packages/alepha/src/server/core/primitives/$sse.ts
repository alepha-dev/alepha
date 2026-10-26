import {
  $inject,
  $store,
  AlephaError,
  type Async,
  createPrimitive,
  type Infer,
  type Middleware,
  type MiddlewareProvides,
  PipelineHandler,
  PipelinePrimitive,
  type PipelinePrimitiveOptions,
  type ZObject,
  type ZType,
} from "alepha";
import { KIND } from "alepha/internal";
import { $logger } from "alepha/logger";

import type { RouteMethod } from "../constants/routeMethods.ts";
import { ServerReply } from "../helpers/ServerReply.ts";
import { SseFetchResponse, SseStream } from "../helpers/SseStreams.ts";
import type {
  RequestConfigSchema,
  ServerRequest,
} from "../interfaces/ServerRequest.ts";
import { ServerProvider } from "../providers/ServerProvider.ts";
import { ServerRouterProvider } from "../providers/ServerRouterProvider.ts";
import { serverApiOptions } from "./$action.ts";

// ----------------------------------------------------------------------------------------------------------

/**
 * Schema configuration for an SSE endpoint.
 */
export interface SseConfigSchema {
  /**
   * Request body schema.
   */
  body?: ZObject;

  /**
   * Path parameters schema.
   */
  params?: ZObject;

  /**
   * Query parameters schema.
   */
  query?: ZObject;

  /**
   * Request headers schema.
   */
  headers?: ZObject;

  /**
   * Schema for the data payload of each SSE event.
   */
  data?: ZType;
}

// ----------------------------------------------------------------------------------------------------------

/**
 * Context object passed to the SSE handler function.
 */
export interface SseHandlerContext<TConfig extends SseConfigSchema> {
  /**
   * Parsed request body.
   */
  body: TConfig["body"] extends ZObject ? Infer<TConfig["body"]> : any;

  /**
   * Parsed path parameters.
   */
  params: TConfig["params"] extends ZObject
    ? Infer<TConfig["params"]>
    : Record<string, string>;

  /**
   * Parsed query parameters.
   */
  query: TConfig["query"] extends ZObject
    ? Partial<Infer<TConfig["query"]>>
    : Record<string, any>;

  /**
   * Parsed request headers.
   */
  headers: TConfig["headers"] extends ZObject
    ? Infer<TConfig["headers"]>
    : Record<string, string>;

  /**
   * The underlying server request object.
   */
  request: ServerRequest;

  /**
   * Emit an SSE event to the client.
   *
   * Returns `false` once the stream is over — the client disconnected or
   * {@link close} was called — and the event was dropped. Long-running
   * handlers should stop when it does.
   */
  emit: (
    data: TConfig["data"] extends ZType ? Infer<TConfig["data"]> : any,
  ) => boolean;

  /**
   * Close the SSE stream.
   */
  close: () => void;

  /**
   * Aborts when the stream is over, most importantly when the client
   * disconnects.
   *
   * Composed with the ambient signal (the request's, for an HTTP stream),
   * and the same object as `alepha.context.signal` inside the handler, so a
   * `fetch` or a read the handler makes stops with the stream.
   *
   * An SSE handler typically loops for as long as the client is listening;
   * without this it has no way to learn that nobody is, and keeps running
   * (and holding its resources) forever.
   *
   * ```typescript
   * handler: async ({ emit, signal }) => {
   *   while (!signal.aborted) {
   *     emit(await nextUpdate());
   *   }
   * }
   * ```
   */
  signal: AbortSignal;
}

/**
 * Handler function type for SSE endpoints.
 */
export type SseHandler<
  TConfig extends SseConfigSchema = SseConfigSchema,
  TUse extends readonly Middleware[] = readonly Middleware[],
> = (
  context: SseHandlerContext<TConfig> & MiddlewareProvides<TUse>,
) => Async<void>;

// ----------------------------------------------------------------------------------------------------------

/**
 * Options for the $sse primitive.
 */
export interface SsePrimitiveOptions<
  TConfig extends SseConfigSchema,
  TUse extends readonly Middleware[] = readonly Middleware[],
> extends PipelinePrimitiveOptions {
  /**
   * Name of the SSE endpoint.
   */
  name?: string;

  /**
   * Group SSE endpoints together.
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
   * The config schema for the SSE endpoint.
   */
  schema?: TConfig;

  /**
   * A short description of the endpoint. Used for documentation purposes.
   */
  description?: string;

  /**
   * Disable the SSE endpoint.
   */
  disabled?: boolean;

  /**
   * Main SSE handler. Receives context with emit/close functions.
   */
  /**
   * Middlewares wrapping the handler, as on `$action`: `use: [$secure()]`
   * refuses an anonymous caller before the stream opens and hands the
   * handler a non-optional `user`.
   */
  use?: TUse;

  handler: SseHandler<TConfig, TUse>;
}

// ----------------------------------------------------------------------------------------------------------

/**
 * Creates a Server-Sent Events (SSE) primitive for streaming typed events to clients.
 *
 * SSE endpoints provide a unidirectional stream from server to client over HTTP,
 * with full type safety for event data. The handler receives `emit()` and `close()`
 * functions to control the stream.
 *
 * **Key Features**
 * - Full TypeScript inference for event data types
 * - Automatic schema validation using Zod
 * - An explicit path on every endpoint, no convention to remember
 * - Direct invocation (`run()`) returns an `SseStream` async iterable
 * - HTTP requests (`fetch()`) returns an `SseFetchResponse` async iterable
 * - Built-in `text/event-stream` content-type handling
 *
 * **URL Generation**
 *
 * All `$sse` paths are automatically prefixed with `/api`.
 *
 * ```ts
 * $sse({ path: "/events" })     // POST /api/events
 * $sse({ path: "/feed/:id" })   // POST /api/feed/:id
 * ```
 *
 * The HTTP method is always POST. `path` is required, so renaming the
 * property never moves the URL.
 *
 * @example
 * ```ts
 * class NotificationController {
 *   events = $sse({
 *     path: "/notifications/events",
 *     schema: {
 *       data: z.object({
 *         type: z.text(),
 *         message: z.text(),
 *       }),
 *     },
 *     handler: async ({ emit, close }) => {
 *       emit({ type: "welcome", message: "Connected!" });
 *       // ... stream events ...
 *       close();
 *     },
 *   });
 * }
 * ```
 */
export const $sse = <
  TConfig extends SseConfigSchema,
  const TUse extends readonly Middleware[] = [],
>(
  options: SsePrimitiveOptions<TConfig, TUse>,
): SsePrimitiveFn<TConfig> => {
  const instance = createPrimitive(
    SsePrimitive<TConfig>,
    options as unknown as SsePrimitiveOptions<TConfig>,
  );
  const fn = (
    config?: SseRequestEntry<TConfig>,
  ): SseStream<SseEventData<TConfig>> => {
    return instance.run(config);
  };
  Object.defineProperty(fn, "name", {
    get(): string {
      return instance.options.name || instance.config.propertyKey;
    },
  });
  return Object.setPrototypeOf(fn, instance) as SsePrimitiveFn<TConfig>;
};

// ----------------------------------------------------------------------------------------------------------

/**
 * The SSE primitive class extending PipelinePrimitive.
 *
 * Registers a POST route that streams `text/event-stream` responses.
 * Supports direct invocation via `run()` and HTTP via `fetch()`.
 */
export class SsePrimitive<
  TConfig extends SseConfigSchema,
> extends PipelinePrimitive<SsePrimitiveOptions<TConfig>> {
  /**
   * Marks the context of an HTTP call with the callback the innermost
   * handler calls on entry: past every `use` middleware, so the response
   * status is still free to be a 401 or a 403 until then.
   */
  public static readonly ENTERED = Symbol("sse.entered");

  /**
   * The handler composed with its `use` middlewares. The innermost layer
   * reports its entry (see {@link ENTERED}) before running the user handler.
   */
  public override readonly handler = new PipelineHandler(
    (context: Record<PropertyKey, any>) => {
      context[SsePrimitive.ENTERED]?.();
      return this.options.handler(context as any);
    },
    this.options.use,
  );

  protected readonly log = $logger();
  protected readonly settings = $store(serverApiOptions);
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);

  protected onInit() {
    // Typed as required; this guards an untyped caller, whose endpoint would
    // otherwise register at `/api/undefined`.
    if (!this.options.path) {
      throw new AlephaError(
        `SSE endpoint '${this.name}' must declare a 'path'.`,
      );
    }
    if (this.options.disabled) {
      this.log.debug(
        `SSE endpoint '${this.name}' is disabled. It won't be available in the API.`,
      );
      return;
    }
    this.serverRouterProvider.createRoute({
      method: this.method,
      path: `${this.prefix}${this.path}`,
      schema: this.requestConfigSchema,
      handler: (request: ServerRequest) => this.httpHandler(request),
    });
  }

  /**
   * Returns the /api prefix.
   */
  public get prefix(): string {
    return this.settings.prefix;
  }

  /**
   * Returns the name of the SSE endpoint.
   */
  public get name(): string {
    return this.options.name || this.config.propertyKey;
  }

  /**
   * Returns the group of the SSE endpoint.
   */
  public get group(): string {
    return this.options.group || this.config.service.name;
  }

  /**
   * Returns the HTTP method. SSE always uses POST.
   */
  public get method(): RouteMethod {
    return "POST";
  }

  /**
   * Returns the path of the SSE endpoint, without the API prefix.
   */
  public get path(): string {
    return this.options.path;
  }

  /**
   * Returns the schema configuration.
   */
  public get schema(): TConfig | undefined {
    return this.options.schema;
  }

  /**
   * Constructs a RequestConfigSchema from the SSE config for route registration.
   */
  protected get requestConfigSchema(): RequestConfigSchema | undefined {
    if (!this.options.schema) return undefined;
    return {
      body: this.options.schema.body,
      params: this.options.schema.params,
      query: this.options.schema.query,
      headers: this.options.schema.headers,
    };
  }

  /**
   * Call the SSE handler directly and return a typed async iterable stream.
   * There is no HTTP layer involved.
   */
  public run(
    config?: SseRequestEntry<TConfig>,
  ): SseStream<SseEventData<TConfig>> {
    if (this.options.disabled) {
      throw new AlephaError(`SSE endpoint '${this.name}' is disabled.`);
    }

    const stream = new SseStream<SseEventData<TConfig>>();
    const {
      body,
      params = {},
      query = {},
      headers = {},
    } = (config ?? {}) as SseRequestEntryContainer<SseConfigSchema>;

    const url = new URL(`http://localhost${this.path}`);
    const reply = new ServerReply();

    const serverRequest: Partial<ServerRequest> = {
      method: this.method,
      url,
      body,
      params,
      query,
      headers,
      reply,
      metadata: {
        routePath: `${this.prefix}${this.path}`,
        routeMethod: this.method,
      },
    };

    const abortController = new AbortController();

    // The handler runs under its stream's signal composed with the caller's
    // (#E85); `context.signal` is that same object.
    this.alepha.context.withSignal(abortController.signal, () => {
      const signal = this.handlerSignal(abortController);

      const context = {
        body: body as any,
        params: params as any,
        query: query as any,
        headers: headers as any,
        request: serverRequest as ServerRequest,
        // What a `use` middleware resolved (`$secure` writes the request's
        // `user`), read when the handler asks.
        get user() {
          return (serverRequest as { user?: unknown }).user;
        },
        signal,
        emit: (data: SseEventData<TConfig>) => {
          if (signal.aborted) {
            return false;
          }
          stream.push(data);
          return true;
        },
        close: () => {
          abortController.abort(new AlephaError("SSE stream closed"));
          stream.end();
        },
      };

      const handlerFn = this.handler.run.bind(this.handler);

      // run handler async, errors propagate to stream. In its own fork with
      // the synthetic request as the action request, as `$action.run()`
      // does, so a `use` middleware finds it (`$secure` sets its `user`).
      Promise.resolve()
        .then(() =>
          this.alepha.fork(() => handlerFn(context), {
            "alepha.action.request": serverRequest,
          }),
        )
        .then(() => {
          abortController.abort(new AlephaError("SSE handler finished"));
          // auto-close stream when handler finishes without calling close()
          stream.end();
        })
        .catch((error: Error) => {
          abortController.abort(error);
          stream.fail(error);
        });
    });

    return stream;
  }

  /**
   * The handler's signal, read inside `withSignal`: the stream's own
   * composed with the ambient one. Without ALS (browser builds) there is no
   * ambient layer, and the stream's own is the whole of it.
   */
  protected handlerSignal(own: AbortController): AbortSignal {
    return this.alepha.context.als ? this.alepha.context.signal : own.signal;
  }

  /**
   * Works like `run`, but always fetches (http request) the route.
   * Returns an `SseFetchResponse` that can be async-iterated for typed events.
   */
  public async fetch(
    config?: SseRequestEntry<TConfig>,
  ): Promise<SseFetchResponse<SseEventData<TConfig>>> {
    const host = this.serverProvider.hostname;
    const url = this.buildFetchUrl(host, config);
    const { body, headers: configHeaders = {} } = (config ??
      {}) as SseRequestEntryContainer<SseConfigSchema>;

    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
        ...configHeaders,
      },
    };

    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }

    const response = await fetch(url, requestInit);
    return new SseFetchResponse<SseEventData<TConfig>>(response);
  }

  /**
   * HTTP handler for the registered route.
   * Returns a ReadableStream with SSE-formatted events, once every `use`
   * middleware has let the request through: a `$secure` refusal is then the
   * route's error (a 401 or a 403), not an error inside a 200 stream.
   */
  protected async httpHandler(request: ServerRequest): Promise<ReadableStream> {
    let entered!: () => void;
    let refused!: (error: unknown) => void;
    const gate = new Promise<void>((resolve, reject) => {
      entered = resolve;
      refused = reject;
    });
    const stream = this.httpStream(request, entered, refused);
    await gate;
    return stream;
  }

  /**
   * The event stream of one HTTP call. `entered` fires when the user handler
   * starts, `refused` when the pipeline fails before it did.
   */
  protected httpStream(
    request: ServerRequest,
    entered: () => void,
    refused: (error: unknown) => void,
  ): ReadableStream {
    let started = false;
    const reply = request.reply;
    reply.setHeader("content-type", "text/event-stream");
    reply.setHeader("cache-control", "no-cache");
    reply.setHeader("connection", "keep-alive");

    const handlerFn = this.handler.run.bind(this.handler);

    const abortController = new AbortController();

    return new ReadableStream({
      // The handler runs under the stream's signal composed with the
      // request's (#E85): a disconnect reaches it through either the stream's
      // `cancel` or the request's own signal, and what it calls inherits it.
      start: (controller) =>
        this.alepha.context.withSignal(abortController.signal, () => {
          const signal = this.handlerSignal(abortController);
          const encoder = new TextEncoder();
          const context = {
            [SsePrimitive.ENTERED]: () => {
              started = true;
              entered();
            },
            body: request.body as any,
            params: request.params as any,
            query: request.query as any,
            headers: request.headers as any,
            request,
            // `$secure` writes the HTTP request's `user`.
            get user() {
              return (request as { user?: unknown }).user;
            },
            signal,
            emit: (data: SseEventData<TConfig>) => {
              if (signal.aborted) {
                return false;
              }
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
                );
                return true;
              } catch {
                // stream may already be closed
                return false;
              }
            },
            close: () => {
              abortController.abort(new AlephaError("SSE stream closed"));
              try {
                controller.close();
              } catch {
                // stream may already be closed
              }
            },
          };

          Promise.resolve()
            .then(() => handlerFn(context))
            .then(() => {
              entered();
              abortController.abort(new AlephaError("SSE handler finished"));
              try {
                controller.close();
              } catch {
                // already closed
              }
            })
            .catch((error: Error) => {
              abortController.abort(error);
              if (!started) {
                refused(error);
              }
              try {
                controller.error(error);
              } catch {
                // already closed
              }
            });
        }),
      // The runtime cancels the stream when the client goes away. Aborting
      // here is the only signal a looping handler ever gets.
      cancel: (reason) => {
        abortController.abort(
          reason ?? new AlephaError("SSE client disconnected"),
        );
      },
    });
  }

  /**
   * Build the fetch URL with path variables and query params.
   */
  protected buildFetchUrl(
    host: string,
    config?: SseRequestEntry<TConfig>,
  ): string {
    let url = `${host}${this.prefix}${this.path}`;

    const { params, query } = (config ??
      {}) as SseRequestEntryContainer<SseConfigSchema>;

    if (params && typeof params === "object") {
      // Same rules as `HttpClient.pathVariables`: whole-token match (so `:id`
      // cannot eat the prefix of `:idType`), a replace function (so `$&` in a
      // value stays literal), and percent-encoded values.
      url = url.replace(
        /\{([A-Za-z0-9_]+)\}|:([A-Za-z0-9_]+)/g,
        (match, braced, colon) => {
          const key = braced ?? colon;
          return Object.hasOwn(params, key)
            ? encodeURIComponent(String((params as Record<string, any>)[key]))
            : match;
        },
      );
    }

    if (query && typeof query === "object") {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        url += `?${qs}`;
      }
    }

    return url;
  }
}

// ----------------------------------------------------------------------------------------------------------

/**
 * Combined callable + SsePrimitive interface.
 */
export interface SsePrimitiveFn<
  TConfig extends SseConfigSchema,
> extends SsePrimitive<TConfig> {
  (config?: SseRequestEntry<TConfig>): SseStream<SseEventData<TConfig>>;
}

$sse[KIND] = SsePrimitive;

// ----------------------------------------------------------------------------------------------------------

/**
 * Infer the event data type from an SSE config schema.
 */
export type SseEventData<TConfig extends SseConfigSchema> =
  TConfig["data"] extends ZType ? Infer<TConfig["data"]> : any;

/**
 * Request entry type for SSE endpoints (body, params, query, headers).
 */
export type SseRequestEntry<
  TConfig extends SseConfigSchema,
  T = SseRequestEntryContainer<TConfig>,
> = {
  [K in keyof T as T[K] extends undefined ? never : K]: T[K];
};

/**
 * Full container type for SSE request entries.
 */
export type SseRequestEntryContainer<TConfig extends SseConfigSchema> = {
  body: TConfig["body"] extends ZObject ? Infer<TConfig["body"]> : undefined;

  params: TConfig["params"] extends ZObject
    ? Infer<TConfig["params"]>
    : undefined;

  headers?: TConfig["headers"] extends ZObject
    ? Infer<TConfig["headers"]>
    : Record<string, string>;

  query?: TConfig["query"] extends ZObject
    ? Partial<Infer<TConfig["query"]>>
    : Record<string, string>;
};
