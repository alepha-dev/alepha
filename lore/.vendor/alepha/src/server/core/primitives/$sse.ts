import {
  $inject,
  $store,
  AlephaError,
  type Async,
  createPrimitive,
  type Infer,
  KIND,
  PipelinePrimitive,
  type PipelinePrimitiveOptions,
  type ZObject,
  type ZType,
  z,
} from "alepha";
import { $logger } from "alepha/logger";

import type { RouteMethod } from "../constants/routeMethods.ts";
import { ServerReply } from "../helpers/ServerReply.ts";
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
export type SseHandler<TConfig extends SseConfigSchema = SseConfigSchema> = (
  context: SseHandlerContext<TConfig>,
) => Async<void>;

// ----------------------------------------------------------------------------------------------------------

/**
 * Options for the $sse primitive.
 */
export interface SsePrimitiveOptions<
  TConfig extends SseConfigSchema,
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
   * Pathname of the route. If not provided, property key is used.
   */
  path?: string;

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
  handler: SseHandler<TConfig>;
}

// ----------------------------------------------------------------------------------------------------------

/**
 * Async iterable stream of SSE events.
 *
 * Supports push-based event delivery via `push()`, error propagation
 * via `fail()`, and clean termination via `end()`.
 */
export class SseStream<T> implements AsyncIterable<T> {
  protected queue: T[] = [];
  protected error: Error | null = null;
  protected done = false;
  protected resolve: (() => void) | null = null;
  protected listeners: Array<(data: T) => void> = [];

  /**
   * Push a new event into the stream.
   */
  public push(data: T): void {
    if (this.done) return;
    this.queue.push(data);
    for (const listener of this.listeners) {
      listener(data);
    }
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  /**
   * Signal an error on the stream.
   */
  public fail(error: Error): void {
    this.error = error;
    this.done = true;
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  /**
   * End the stream gracefully.
   */
  public end(): void {
    this.done = true;
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  /**
   * Subscribe to new events as they arrive.
   */
  public subscribe(listener: (data: T) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.error) {
        throw this.error;
      }
      if (this.done) {
        return;
      }
      await new Promise<void>((r) => {
        this.resolve = r;
      });
    }
  }
}

// ----------------------------------------------------------------------------------------------------------

/**
 * Response wrapper for SSE fetch requests.
 *
 * Wraps a standard `Response` and parses the `text/event-stream` body
 * into an async iterable of typed events.
 */
export class SseFetchResponse<T> implements AsyncIterable<T> {
  public readonly response: Response;

  constructor(response: Response) {
    this.response = response;
  }

  /**
   * HTTP status code of the response.
   */
  public get status(): number {
    return this.response.status;
  }

  /**
   * HTTP status text of the response.
   */
  public get statusText(): string {
    return this.response.statusText;
  }

  /**
   * Response headers.
   */
  public get headers(): Headers {
    return this.response.headers;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    const reader = this.response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              yield JSON.parse(data) as T;
            } catch {
              // skip non-JSON data lines
            }
          }
        }
      }

      // process remaining buffer
      if (buffer.startsWith("data: ")) {
        const data = buffer.slice(6);
        try {
          yield JSON.parse(data) as T;
        } catch {
          // skip non-JSON data lines
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
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
 * - Convention-based URL generation with customizable paths
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
 * The HTTP method is always POST.
 *
 * @example
 * ```ts
 * class NotificationController {
 *   events = $sse({
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
export const $sse = <TConfig extends SseConfigSchema>(
  options: SsePrimitiveOptions<TConfig>,
): SsePrimitiveFn<TConfig> => {
  const instance = createPrimitive(SsePrimitive<TConfig>, options);
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
  protected readonly log = $logger();
  protected readonly settings = $store(serverApiOptions);
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);

  protected onInit() {
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
   * Returns the path of the SSE endpoint.
   */
  public get path(): string {
    if (this.options.path) {
      return this.options.path;
    }

    let path = `/${this.name}`;

    if (this.options.schema?.params) {
      for (const [key] of Object.entries(
        z.schema.shape(this.options.schema.params),
      )) {
        path += `/:${key}`;
      }
    }

    return path;
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

    const url = new URL(`http://localhost${this.path ?? ""}`);
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

    const context: SseHandlerContext<TConfig> = {
      body: body as any,
      params: params as any,
      query: query as any,
      headers: headers as any,
      request: serverRequest as ServerRequest,
      signal: abortController.signal,
      emit: (data: SseEventData<TConfig>) => {
        if (abortController.signal.aborted) {
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

    // run handler async, errors propagate to stream
    Promise.resolve()
      .then(() => handlerFn(context))
      .then(() => {
        abortController.abort(new AlephaError("SSE handler finished"));
        // auto-close stream when handler finishes without calling close()
        stream.end();
      })
      .catch((error: Error) => {
        abortController.abort(error);
        stream.fail(error);
      });

    return stream;
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
   * Returns a ReadableStream with SSE-formatted events.
   */
  protected httpHandler(request: ServerRequest): ReadableStream {
    const reply = request.reply;
    reply.setHeader("content-type", "text/event-stream");
    reply.setHeader("cache-control", "no-cache");
    reply.setHeader("connection", "keep-alive");

    const handlerFn = this.handler.run.bind(this.handler);

    const abortController = new AbortController();

    return new ReadableStream({
      start: (controller) => {
        const encoder = new TextEncoder();
        const context: SseHandlerContext<TConfig> = {
          body: request.body as any,
          params: request.params as any,
          query: request.query as any,
          headers: request.headers as any,
          request,
          signal: abortController.signal,
          emit: (data: SseEventData<TConfig>) => {
            if (abortController.signal.aborted) {
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
            abortController.abort(new AlephaError("SSE handler finished"));
            try {
              controller.close();
            } catch {
              // already closed
            }
          })
          .catch((error: Error) => {
            abortController.abort(error);
            try {
              controller.error(error);
            } catch {
              // already closed
            }
          });
      },
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
