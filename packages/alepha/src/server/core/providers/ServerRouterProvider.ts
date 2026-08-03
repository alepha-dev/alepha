import { Readable as NodeStream } from "node:stream";
import { ReadableStream as NodeWebStream } from "node:stream/web";
import {
  $inject,
  Alepha,
  coerceScalar,
  isFileLike,
  isTypeFile,
  type Middleware,
  PipelineHandler,
  type ZObject,
  z,
} from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $logger, LogBufferProvider } from "alepha/logger";
import { RouterProvider } from "alepha/router";
import type { RouteMethod } from "../constants/routeMethods.ts";
import { errorNameByStatus, HttpError } from "../errors/HttpError.ts";
import { ValidationError } from "../errors/ValidationError.ts";
import type { ServerReply } from "../helpers/ServerReply.ts";
import type {
  RequestConfigSchema,
  ResponseKind,
  ServerRequest,
  ServerRequestConfig,
  ServerRoute,
  ServerRouteInput,
  ServerRouteMatcher,
} from "../interfaces/ServerRequest.ts";
import { ServerRequestParser } from "../services/ServerRequestParser.ts";
import { ServerTimingProvider } from "./ServerTimingProvider.ts";

/**
 * Main router for all routes server side.
 *
 * Reminder:
 * - $route => generic route
 * - $action => action route (for API calls)
 * - $page => React route (for React SSR)
 */
export class ServerRouterProvider extends RouterProvider<ServerRouteMatcher> {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly routes: ServerRoute[] = [];
  protected readonly serverTimingProvider = $inject(ServerTimingProvider);
  protected readonly serverRequestParser = $inject(ServerRequestParser);
  protected readonly logBuffer = $inject(LogBufferProvider);
  protected readonly queryKeysCache = new WeakMap<object, string[]>();
  protected readonly globalMiddlewareRegistry: GlobalMiddlewareEntry[] = [];

  /**
   * Get cached keys for a query schema, computing them lazily on first access.
   */
  protected getQuerySchemaKeys(schema: ZObject): string[] {
    let keys = this.queryKeysCache.get(z.schema.shape(schema));
    if (!keys) {
      keys = Object.keys(z.schema.shape(schema));
      this.queryKeysCache.set(z.schema.shape(schema), keys);
    }
    return keys;
  }

  public pushMiddleware(
    pattern: string,
    middleware: Middleware[],
    options?: PushMiddlewareOptions,
  ): void {
    this.globalMiddlewareRegistry.push({ pattern, middleware, ...options });
    for (const route of this.getRoutes(pattern)) {
      if (this.matchesMiddlewareFilter(route, options)) {
        route.handler.use(...middleware);
      }
    }
  }

  /**
   * Check if a route passes the middleware filter options (method, exclude).
   */
  protected matchesMiddlewareFilter(
    route: ServerRoute,
    options?: PushMiddlewareOptions,
  ): boolean {
    if (options?.method) {
      const methods = Array.isArray(options.method)
        ? options.method
        : [options.method];
      if (
        route.method &&
        !methods.includes(route.method.toUpperCase() as RouteMethod)
      ) {
        return false;
      }
    }
    if (options?.exclude) {
      for (const exclude of options.exclude) {
        if (route.path === exclude || route.path.startsWith(`${exclude}/`)) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Check if a route path matches a pattern.
   * Wildcard `*` at end = prefix match, otherwise exact match.
   */
  protected matchesPattern(routePath: string, pattern: string): boolean {
    if (pattern.endsWith("*")) {
      return routePath.startsWith(pattern.slice(0, -1));
    }
    return routePath === pattern;
  }

  /**
   * Get all registered routes, optionally filtered by a pattern.
   *
   * Pattern accept simple wildcard '*' at the end.
   * Example: '/api/*' will match all routes starting with '/api/' but '/api/' will match only that exact route.
   */
  public getRoutes(pattern?: string): ServerRoute[] {
    if (pattern) {
      return this.routes.filter((route) =>
        this.matchesPattern(route.path, pattern),
      );
    }
    return this.routes;
  }

  /**
   * Create a new server route.
   *
   * Accepts both `PipelineHandler` and plain handler functions.
   * Plain functions are auto-wrapped in `PipelineHandler`.
   */
  public createRoute<TConfig extends RequestConfigSchema = RequestConfigSchema>(
    input: ServerRouteInput<TConfig>,
  ): void {
    // Auto-wrap plain function handlers in PipelineHandler
    if (!(input.handler instanceof PipelineHandler)) {
      (input as any).handler = new PipelineHandler(input.handler);
    }

    const route = input as unknown as ServerRoute<TConfig>;
    route.method ??= "GET";
    route.method = route.method.toUpperCase() as RouteMethod;

    this.routes.push(route);

    for (const entry of this.globalMiddlewareRegistry) {
      if (this.matchesPattern(route.path, entry.pattern)) {
        if (this.matchesMiddlewareFilter(route, entry)) {
          route.handler.use(...entry.middleware);
        }
      }
    }

    const path = `/${route.method}/${route.path}`.replace(/\/+/g, "/");
    const responseKind = this.getResponseType(route.schema);

    this.log.trace(`Create route ${path}`);

    this.push({
      path,
      handler: (rawRequest) => {
        const request =
          this.serverRequestParser.createServerRequest(rawRequest);

        return this.alepha.context.run(
          () => this.processRequest(request, route, responseKind),
          {
            context: this.getContextId(rawRequest.headers),
            // Retains this request's log entries so that a `server:onError`
            // consumer can ship them as breadcrumbs. Contributes nothing to
            // the context when buffering is disabled.
            ...this.logBuffer.seed(),
          },
        );
      },
    });
  }

  /**
   * Get or generate a context ID from request headers.
   *
   * It first checks for common headers like 'x-request-id' or 'x-correlation-id' that may be set by proxies or clients.
   * If none of these headers are present, it generates a new UUID to ensure uniqueness.
   *
   * Note: In production environments, it's recommended to have a proxy (e.g. Nginx, Cloudflare) that sets a consistent request ID header for better traceability across services.
   */
  protected getContextId(headers: Record<string, string>): string {
    // note: we trust these headers as all our environments are behind a proxy
    return (
      headers["x-request-id"] ||
      headers["x-correlation-id"] ||
      this.crypto.randomUUID()
    );
  }

  /**
   * Process an incoming request through the full lifecycle:
   * onRequest → handler → onSend → response → onResponse
   */
  protected async processRequest(
    request: ServerRequest,
    route: ServerRoute,
    responseKind: ResponseKind,
  ) {
    try {
      await this.runRouteHandler(route, request, responseKind);
    } catch (error) {
      await this.errorHandler(route, request, error as Error);
    }

    const payload = { request, route, response: undefined as any };
    await this.alepha.events.emit("server:onSend", payload, { catch: true });

    const reply = request.reply;
    const response = {
      status: reply.status ?? (reply.body ? 200 : 204), // default status: 200 if body is set, otherwise 204
      headers: reply.headers,
      body: reply.body as any,
    };

    payload.response = response;
    await this.alepha.events.emit("server:onResponse", payload, {
      catch: true,
    });

    return response;
  }

  /**
   * Run the route handler with request validation and response serialization.
   */
  protected async runRouteHandler(
    route: ServerRoute,
    request: ServerRequest,
    responseKind: ResponseKind,
  ) {
    // Built-in hooks: body parsing, security, logging
    await this.alepha.events.emit("server:onRequest", { request, route });

    // A hook (e.g. CORS preflight) may have already written the response
    const reply = request.reply;
    if (reply.body || (reply.status && reply.status >= 200)) {
      return;
    }

    // Store route path info for middleware (e.g. $secure auto-permission lookup)
    request.metadata.routePath = route.path;
    request.metadata.routeMethod = route.method;

    // Make the request available to handlers via alepha.context
    this.alepha.set("alepha.http.request", request);

    const timing = this.serverTimingProvider;

    timing.beginTiming("validateRequest");
    try {
      this.validateRequest(route, request);
    } finally {
      timing.endTiming("validateRequest");
    }

    timing.beginTiming("runHandler");
    try {
      const result = await route.handler.run(request);
      if (result !== undefined) {
        reply.body = result;
      }
    } finally {
      timing.endTiming("runHandler");
    }

    timing.beginTiming("serializeResponse");
    try {
      this.serializeResponse(route, reply, responseKind);
    } finally {
      timing.endTiming("serializeResponse");
    }
  }

  /**
   * Transform reply body based on response kind and route schema.
   */
  public serializeResponse(
    route: ServerRoute,
    reply: ServerReply,
    responseKind: ResponseKind,
  ): void {
    const headers = reply.headers;

    if (responseKind === "json" && route.schema?.response) {
      headers["content-type"] = "application/json";
      reply.body = this.alepha.codec.encode(route.schema.response, reply.body, {
        as: "string" as const,
      });
      return;
    }

    if (responseKind === "file") {
      if (!isFileLike(reply.body)) {
        throw new HttpError({
          status: 500,
          message: "Invalid response body - not a file",
        });
      }
      headers["content-type"] = reply.body.type;
      const sanitizedName = reply.body.name
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"')
        .replaceAll("\r", "")
        .replaceAll("\n", "");
      headers["content-disposition"] =
        `attachment; filename="${sanitizedName}"`;
      reply.body = reply.body.stream();
      return;
    }

    if (responseKind === "text") {
      reply.body = String(reply.body);
      // Detect HTML responses (starts with <!DOCTYPE html>)
      if (reply.body.startsWith("<!DOCTYPE html>")) {
        headers["content-type"] ??= "text/html; charset=UTF-8";
      } else {
        headers["content-type"] ??= "text/plain";
      }
      return;
    }

    if (reply.body == null || responseKind === "void") {
      delete (headers as Record<string, unknown>)["content-type"];
      reply.body = undefined;
      return;
    }

    if (Buffer.isBuffer(reply.body)) {
      headers["content-type"] ??= "application/octet-stream";
      return;
    }

    if (
      reply.body instanceof NodeWebStream ||
      reply.body instanceof NodeStream
    ) {
      headers["content-type"] ??= "application/octet-stream";
      return;
    }

    // Plain objects/arrays → auto-serialize as JSON
    if (typeof reply.body === "object") {
      headers["content-type"] ??= "application/json";
      reply.body = JSON.stringify(reply.body);
      return;
    }

    headers["content-type"] ??= "text/plain";
    reply.body = String(reply.body);
  }

  /**
   * Determine response type based on route schema.
   */
  protected getResponseType(schema?: RequestConfigSchema): ResponseKind {
    if (schema?.response) {
      if (
        z.schema.isObject(schema.response) ||
        z.schema.isRecord(schema.response) ||
        z.schema.isArray(schema.response)
      ) {
        return "json";
      }

      if (
        z.schema.isString(schema.response) ||
        z.schema.isInteger(schema.response) ||
        z.schema.isNumber(schema.response) ||
        z.schema.isBoolean(schema.response)
      ) {
        return "text";
      }

      if (isTypeFile(schema.response)) {
        return "file";
      }

      if (z.schema.isVoid(schema.response)) {
        return "void";
      }
    }

    return "any";
  }

  /**
   * Handle errors during request processing.
   */
  protected async errorHandler(
    route: ServerRoute,
    request: ServerRequest,
    error: Error,
  ) {
    // Reset body — it's likely invalid after an error
    const reply = request.reply;
    reply.body = null;

    // Let error hooks handle it first (e.g. custom error pages, Sentry)
    await this.alepha.events.emit("server:onError", { request, route, error });
    // |
    // |
    // --> If a hook already set the response, we're done!
    if (reply.status) return;

    const requestId = request.requestId;

    if (error instanceof HttpError) {
      reply.status = error.status;
      reply.headers["content-type"] = "application/json";
      const errorJson = HttpError.toJSON(error);
      errorJson.requestId = requestId;

      // A 5xx cause is internal (DB URLs, upstream errors, stack-y hints) and
      // must not reach the client in production — the same rule the
      // non-HttpError branches below already apply to `message`. 4xx causes
      // are deliberate, client-facing context and are kept.
      if (error.status >= 500 && this.alepha.isProduction()) {
        errorJson.cause = undefined;
        errorJson.details = undefined;
        errorJson.message = "Internal Server Error";
      }

      reply.body = JSON.stringify(errorJson);
      return;
    }

    // Errors with a known HTTP status (e.g. from upstream libraries)
    if (
      "status" in error &&
      typeof error.status === "number" &&
      errorNameByStatus[error.status]
    ) {
      const status = error.status;
      reply.status = status;
      reply.headers["content-type"] = "application/json";
      reply.body = JSON.stringify({
        status,
        error: errorNameByStatus[status],
        // 4xx messages are intentional and client-facing; 5xx messages can
        // leak internals (DB errors, stack-y hints) — sanitize them in
        // production, exactly like the unknown-error fallback below.
        message:
          status >= 500 && this.alepha.isProduction()
            ? "Internal Server Error"
            : error.message,
        requestId,
      });
      return;
    }

    // Fallback: unknown error → 500.
    //
    // Outside production, say so loudly. A handler that throws a bare
    // `Error` for a business rule ("Current password is incorrect") reads
    // as working in development — the message is passed through — and
    // then silently becomes a generic "Internal Server Error" the moment
    // it ships, because 5xx messages are sanitised above. The author
    // never sees the difference locally, so the mistake survives to
    // production and the user is told nothing.
    if (!this.alepha.isProduction()) {
      this.log.warn(
        "Handler threw a non-HttpError, so it became a 500 and its message " +
          "will be replaced by 'Internal Server Error' in production. " +
          "Throw a BadRequestError / ConflictError / NotFoundError (etc.) " +
          "to keep the message and send an accurate status.",
        { error: (error as Error).message },
      );
    }

    reply.status = 500;
    reply.headers["content-type"] = "application/json";
    reply.body = JSON.stringify({
      status: 500,
      error: "InternalServerError",
      message: this.alepha.isProduction()
        ? "Internal Server Error"
        : error.message,
      requestId,
    });
  }

  /**
   * Validate incoming request against route schema.
   */
  public validateRequest(
    route: { schema?: RequestConfigSchema },
    request: ServerRequestConfig,
  ) {
    if (route.schema?.params) {
      try {
        // Path params are always strings on the wire — coerce each declared
        // param to its schema type (int/bool/date) before strict validation,
        // mirroring the `query` / `headers` handling below. Without this a
        // numeric route param like `/users/:id` (id: z.integer()) fails strict
        // zod validation with "expected number, received string".
        const schemaParams = route.schema.params;
        const coerced: Record<string, unknown> = { ...request.params };
        for (const key of Object.keys(z.schema.shape(schemaParams))) {
          if (coerced[key] != null) {
            coerced[key] = this.coerceParam(
              z.schema.shape(schemaParams)[key],
              coerced[key],
            );
          }
        }
        request.params = this.alepha.codec.validate(
          schemaParams,
          coerced,
        ) as any;
      } catch (error) {
        throw new ValidationError("Invalid request params", error);
      }
    }

    if (route.schema?.query) {
      try {
        const schemaQuery = route.schema.query;
        const keys = this.getQuerySchemaKeys(schemaQuery);
        const query: Record<string, any> = {};

        for (const key of keys) {
          if (request.query[key] != null) {
            const propSchema = z.schema.shape(schemaQuery)[key];
            query[key] = this.alepha.codec.decode(
              propSchema,
              this.coerceParam(propSchema, request.query[key]),
            );
          }
        }

        // Validate the decoded subset against the full schema — decoding only
        // present keys would silently accept a missing required parameter.
        request.query = this.alepha.codec.validate(schemaQuery, query) as any;
      } catch (error) {
        throw new ValidationError("Invalid request query", error);
      }
    }

    if (route.schema?.headers) {
      try {
        const schemaHeaders = route.schema.headers;

        // Per-key decode (mirrors `query` handling): coerces declared header
        // values from strings to their schema types (int/bool/date). Then
        // validate the decoded subset against the full schema so Zod
        // produces consistent error messages (missing-required, type
        // mismatch). Finally merge the decoded values back into
        // `request.headers` so undeclared headers (auth, cookie, user-agent,
        // ...) survive the validation step intact.
        const decoded: Record<string, unknown> = {};
        for (const key of Object.keys(z.schema.shape(schemaHeaders))) {
          const lcKey = key.toLowerCase();
          const value = request.headers[lcKey];
          if (value == null) continue;
          decoded[key] = this.alepha.codec.decode(
            z.schema.shape(schemaHeaders)[key],
            this.coerceParam(z.schema.shape(schemaHeaders)[key], value),
          );
        }

        this.alepha.codec.validate(schemaHeaders, decoded);

        for (const [key, value] of Object.entries(decoded)) {
          (request.headers as Record<string, unknown>)[key.toLowerCase()] =
            value;
        }
      } catch (error) {
        throw new ValidationError("Invalid request header", error);
      }
    }

    if (route.schema?.body) {
      if (z.schema.isString(route.schema.body)) {
        if (typeof request.body !== "string") {
          throw new ValidationError("Request body is not a string");
        }
      } else {
        try {
          request.body = this.alepha.codec.decode(
            route.schema.body,
            request.body,
          );
        } catch (error) {
          throw new ValidationError("Invalid request body", error);
        }
      }
    }
  }

  /**
   * Coerce a raw query/header value (always a string on the wire) to the JS
   * type its schema declares, mirroring `z.coerce` at the HTTP boundary.
   *
   * Only the boundary coerces — request bodies and the ORM stay strict. Values
   * that can't be coerced are passed through unchanged so the subsequent
   * validation produces a proper rejection. Arrays coerce element-wise.
   */
  protected coerceParam(schema: unknown, value: unknown): unknown {
    return coerceScalar(schema, value);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface PushMiddlewareOptions {
  method?: RouteMethod | RouteMethod[];
  exclude?: string[];
}

interface GlobalMiddlewareEntry extends PushMiddlewareOptions {
  pattern: string;
  middleware: Middleware[];
}
