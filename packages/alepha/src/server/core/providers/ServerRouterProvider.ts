import { randomUUID } from "node:crypto";
import { Readable as NodeStream } from "node:stream";
import { ReadableStream as NodeWebStream } from "node:stream/web";
import type { CompiledEventExecutor, Hooks } from "alepha";
import { $inject, Alepha, isFileLike, isTypeFile, t } from "alepha";
import { $logger } from "alepha/logger";
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
  protected readonly routes: ServerRoute[] = [];
  protected readonly serverTimingProvider = $inject(ServerTimingProvider);
  protected readonly serverRequestParser = $inject(ServerRequestParser);

  // Compiled event executors - initialized on first request
  protected compiledOnRequest?: CompiledEventExecutor<
    Hooks["server:onRequest"]
  >;
  protected compiledOnSend?: CompiledEventExecutor<Hooks["server:onSend"]>;
  protected compiledOnResponse?: CompiledEventExecutor<
    Hooks["server:onResponse"]
  >;
  protected compiledOnError?: CompiledEventExecutor<Hooks["server:onError"]>;

  // Cache query schema keys to avoid property enumeration on every request
  // WeakMap allows GC of schemas that are no longer referenced
  protected readonly queryKeysCache = new WeakMap<object, string[]>();

  /**
   * Get cached keys for a query schema, computing them lazily on first access.
   */
  protected getQuerySchemaKeys(schema: { properties: object }): string[] {
    let keys = this.queryKeysCache.get(schema.properties);
    if (!keys) {
      keys = Object.keys(schema.properties);
      this.queryKeysCache.set(schema.properties, keys);
    }
    return keys;
  }

  /**
   * Compile event executors for optimal performance.
   * Called lazily on first request after all hooks are registered.
   */
  protected compileEvents(): void {
    if (this.compiledOnRequest) return; // Already compiled

    this.compiledOnRequest = this.alepha.events.compile("server:onRequest");
    this.compiledOnSend = this.alepha.events.compile("server:onSend", {
      catch: true,
    });
    this.compiledOnResponse = this.alepha.events.compile("server:onResponse", {
      catch: true,
    });
    this.compiledOnError = this.alepha.events.compile("server:onError");
  }

  /**
   * Get all registered routes, optionally filtered by a pattern.
   *
   * Pattern accept simple wildcard '*' at the end.
   * Example: '/api/*' will match all routes starting with '/api/' but '/api/' will match only that exact route.
   */
  public getRoutes(pattern?: string): ServerRoute[] {
    if (pattern) {
      if (pattern.endsWith("*")) {
        const basePattern = pattern.slice(0, -1);
        return this.routes.filter((route) =>
          route.path.startsWith(basePattern),
        );
      } else {
        return this.routes.filter((route) => route.path === pattern);
      }
    }
    return this.routes;
  }

  /**
   * Create a new server route.
   */
  public createRoute<TConfig extends RequestConfigSchema = RequestConfigSchema>(
    route: ServerRoute<TConfig>,
  ): void {
    route.method ??= "GET";
    route.method = route.method.toUpperCase() as RouteMethod;

    this.routes.push(route);

    const path = `/${route.method}/${route.path}`.replace(/\/+/g, "/");
    const responseKind = this.getResponseType(route.schema);

    this.log.trace(`Create route ${path}`);

    this.push({
      path,
      handler: (rawRequest) => {
        const request =
          this.serverRequestParser.createServerRequest(rawRequest);

        // Create context options per request to avoid race conditions with concurrent requests
        return this.alepha.context.run(
          () => this.processRequest(request, route, responseKind),
          { context: this.getContextId(rawRequest.headers) },
        );
      },
    });
  }

  /**
   * Get or generate a context ID from request headers.
   */
  protected getContextId(headers: Record<string, string>): string {
    // Use constant header names to reduce string allocation
    const contextId =
      headers[HEADER_REQUEST_ID] || headers[HEADER_CORRELATION_ID];
    if (contextId) {
      return contextId;
    }

    return randomUUID();
  }

  /**
   * Process an incoming request through the full lifecycle:
   * - onRequest hooks
   * - route handler
   * - onSend hooks
   * - response serialization
   * - onResponse hooks
   */
  protected async processRequest(
    request: ServerRequest,
    route: ServerRoute,
    responseKind: ResponseKind,
  ) {
    // Compile events on first request (after all hooks are registered)
    this.compileEvents();

    // Use try/catch instead of .catch() to avoid function creation overhead
    try {
      await this.runRouteHandler(route, request, responseKind);
    } catch (error) {
      await this.errorHandler(route, request, error as Error);
    }

    // Local reference to reduce property lookups
    const reply = request.reply;

    // Create payload per request to avoid race conditions with concurrent requests
    // (async hooks may hold references while other requests modify shared payloads)
    const payload = { request, route, response: undefined as any };

    // Use compiled executor - only await if returns promise
    const onSendResult = this.compiledOnSend!(payload);
    if (onSendResult) await onSendResult;

    // Create response
    const response = {
      status: reply.status ?? (reply.body ? 200 : 204),
      headers: reply.headers,
      body: reply.body as any,
    };

    payload.response = response;

    // Use compiled executor - only await if returns promise
    const onResponseResult = this.compiledOnResponse!(payload);
    if (onResponseResult) await onResponseResult;

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
    // there are some built-in hooks that are called before the request is handled
    // - ServerBodyParserProvider (parse body)
    // - ServerSecurityProvider (build user from headers)
    // - ServerLoggerProvider (log request)

    // Local reference for timing provider
    const timing = this.serverTimingProvider;

    // Create payload per request to avoid race conditions with concurrent requests
    const payload = { request, route };

    // Use compiled executor - only await if returns promise
    const onRequestResult = this.compiledOnRequest!(payload);
    if (onRequestResult) await onRequestResult;

    // Local reference to reduce property lookups
    const reply = request.reply;
    if (reply.body || (reply.status && reply.status >= 200)) {
      // if the body is already set, we can skip the handler
      // this is useful for middlewares that set the body
      return;
    }

    // request is ready to be used -> inject to context
    this.alepha.context.set<ServerRequest>(CTX_REQUEST, request);

    // validate request
    timing.beginTiming(TIMING_VALIDATE);
    try {
      this.validateRequest(route, request);
    } finally {
      timing.endTiming(TIMING_VALIDATE);
    }

    // call the handler only if the body is not set yet
    timing.beginTiming(TIMING_HANDLER);
    try {
      const result = await route.handler(request);
      if (result) {
        request.reply.body = result;
      }
    } finally {
      timing.endTiming(TIMING_HANDLER);
    }

    // serialize response
    timing.beginTiming(TIMING_SERIALIZE);
    try {
      this.serializeResponse(route, request.reply, responseKind);
    } finally {
      timing.endTiming(TIMING_SERIALIZE);
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
    // Local reference to reduce property lookups
    const headers = reply.headers;

    if (responseKind === "json" && route.schema?.response) {
      headers[HEADER_CONTENT_TYPE] = CONTENT_TYPE_JSON;
      reply.body = this.alepha.codec.encode(
        route.schema.response,
        reply.body,
        ENCODE_OPTIONS_STRING,
      );
      return;
    }

    if (responseKind === "file") {
      if (!isFileLike(reply.body)) {
        throw new HttpError({
          status: 500,
          message: ERROR_NOT_FILE,
        });
      }
      headers[HEADER_CONTENT_TYPE] = reply.body.type;
      headers[HEADER_CONTENT_DISPOSITION] =
        `attachment; filename="${reply.body.name.replaceAll('"', "")}"`;
      reply.body = reply.body.stream();
      return;
    }

    if (responseKind === "text") {
      reply.body = String(reply.body);
      if (
        reply.body.length > 15 &&
        reply.body.charCodeAt(0) === 60 &&
        reply.body.startsWith("<!DOCTYPE html>")
      ) {
        headers[HEADER_CONTENT_TYPE] ??= CONTENT_TYPE_HTML;
      } else {
        headers[HEADER_CONTENT_TYPE] ??= CONTENT_TYPE_TEXT;
      }
      return;
    }

    if (reply.body == null || responseKind === "void") {
      delete headers[HEADER_CONTENT_TYPE];
      reply.body = undefined;
      return;
    }

    if (Buffer.isBuffer(reply.body)) {
      headers[HEADER_CONTENT_TYPE] ??= CONTENT_TYPE_OCTET;
      return;
    }

    if (
      reply.body instanceof NodeWebStream ||
      reply.body instanceof NodeStream
    ) {
      // set content-type to application/octet-stream if not set
      headers[HEADER_CONTENT_TYPE] ??= CONTENT_TYPE_OCTET;
      return;
    }

    // Plain objects/arrays → auto-serialize as JSON
    if (typeof reply.body === "object") {
      headers[HEADER_CONTENT_TYPE] ??= CONTENT_TYPE_JSON;
      reply.body = JSON.stringify(reply.body);
      return;
    }

    headers[HEADER_CONTENT_TYPE] ??= CONTENT_TYPE_TEXT;
    reply.body = String(reply.body);
    return;
  }

  /**
   * Determine response type based on route schema.
   */
  protected getResponseType(schema?: RequestConfigSchema): ResponseKind {
    if (schema?.response) {
      if (
        t.schema.isObject(schema.response) ||
        t.schema.isRecord(schema.response) ||
        t.schema.isArray(schema.response)
      ) {
        return "json";
      }

      if (
        t.schema.isString(schema.response) ||
        t.schema.isInteger(schema.response) ||
        t.schema.isNumber(schema.response) ||
        t.schema.isBoolean(schema.response)
      ) {
        return "text";
      }

      if (isTypeFile(schema.response)) {
        return "file";
      }

      if (t.schema.isVoid(schema.response)) {
        return "void";
      }
    }

    return "any";
  }

  /**
   * When an error occurs during request processing, this method is called.
   */
  protected async errorHandler(
    route: ServerRoute,
    request: ServerRequest,
    error: Error,
  ) {
    // Local references to reduce property lookups
    const reply = request.reply;
    const headers = reply.headers;
    const requestId = request.requestId;

    // Reset body, which is probably invalid!
    // It can be filled by server:onError hook or by the default handler below
    reply.body = null;

    // Use compiled executor - only await if returns promise
    const onErrorResult = this.compiledOnError!({ request, route, error });
    if (onErrorResult) {
      await onErrorResult;
    }

    if (!reply.body && !reply.status) {
      if (error instanceof HttpError) {
        reply.status = error.status;
        headers[HEADER_CONTENT_TYPE] = CONTENT_TYPE_JSON;
        // Avoid spread operator - directly mutate the error JSON
        const errorJson = HttpError.toJSON(error);
        errorJson.requestId = requestId;
        reply.body = JSON.stringify(errorJson);
      } else {
        if (
          "status" in error &&
          typeof error.status === "number" &&
          !!errorNameByStatus[error.status]
        ) {
          const status = error.status;
          reply.status = status;
          headers[HEADER_CONTENT_TYPE] = CONTENT_TYPE_JSON;
          reply.body = JSON.stringify({
            status,
            error: errorNameByStatus[status],
            message: error.message,
            requestId,
          });
          return;
        }

        reply.status = 500;
        headers[HEADER_CONTENT_TYPE] = CONTENT_TYPE_JSON;
        reply.body = JSON.stringify({
          status: 500,
          error: ERROR_INTERNAL,
          message: error.message,
          requestId,
        });
      }
    }
  }

  /**
   * Validate incoming request against route schema.
   */
  public validateRequest(
    route: { schema?: RequestConfigSchema },
    request: ServerRequestConfig,
  ) {
    // Validate params (path parameters)
    if (route.schema?.params) {
      try {
        request.params = this.alepha.codec.validate(
          route.schema.params,
          request.params,
        ) as any;
      } catch (error) {
        throw new ValidationError("Invalid request params", error);
      }
    }

    // Validate query parameters (?key=value&key2=value2)
    if (route.schema?.query) {
      try {
        // Use cached keys instead of for...in enumeration
        const schemaQuery = route.schema.query;
        const keys = this.getQuerySchemaKeys(schemaQuery);
        const query: Record<string, any> = {};

        // Use indexed loop for better performance than for...of
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          if (request.query[key] != null) {
            query[key] = this.alepha.codec.decode(
              schemaQuery.properties[key],
              request.query[key],
            );
          }
        }

        request.query = query;
      } catch (error) {
        throw new ValidationError("Invalid request query", error);
      }
    }

    // Validate headers
    if (route.schema?.headers) {
      try {
        request.headers = this.alepha.codec.validate(
          route.schema.headers,
          request.headers,
        ) as any;
      } catch (error) {
        throw new ValidationError("Invalid request header", error);
      }
    }

    // Validate body
    if (route.schema?.body) {
      if (t.schema.isString(route.schema.body)) {
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
}

// ---------------------------------------------------------------------------------------------------------------------

// Pre-allocated encode options for response serialization
const ENCODE_OPTIONS_STRING = Object.freeze({
  as: "string" as const,
});

// HTTP Headers
const HEADER_CONTENT_TYPE = "content-type";
const HEADER_CONTENT_DISPOSITION = "content-disposition";
const HEADER_REQUEST_ID = "x-request-id";
const HEADER_CORRELATION_ID = "x-correlation-id";

// Content Types
const CONTENT_TYPE_JSON = "application/json";
const CONTENT_TYPE_TEXT = "text/plain";
const CONTENT_TYPE_HTML = "text/html; charset=UTF-8";
const CONTENT_TYPE_OCTET = "application/octet-stream";

// Timing Keys
const TIMING_VALIDATE = "validateRequest";
const TIMING_HANDLER = "runHandler";
const TIMING_SERIALIZE = "serializeResponse";

// Context Keys
const CTX_REQUEST = "request";

// Error Messages
const ERROR_INTERNAL = "InternalServerError";
const ERROR_NOT_FILE = "Invalid response body - not a file";
