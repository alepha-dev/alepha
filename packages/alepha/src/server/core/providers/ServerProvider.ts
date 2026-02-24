import { Readable } from "node:stream";
import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { Route } from "alepha/router";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type {
  NodeRequestEvent,
  ServerRequestData,
  WebRequestEvent,
} from "../interfaces/ServerRequest.ts";
import { ServerRouterProvider } from "./ServerRouterProvider.ts";

// ============================================================================
// Performance Constants
// ============================================================================

// Note: We cannot use frozen/shared empty objects here because downstream code
// may mutate params/query (e.g., validation, React page rendering)

// Header constants for fast property access
const HEADER_X_FORWARDED_PROTO = "x-forwarded-proto";
const HEADER_HOST = "host";

// Protocol prefixes
const PROTO_HTTPS = "https://";
const PROTO_HTTP = "http://";

/**
 * Base server provider to handle incoming requests and route them.
 *
 * This is the default implementation for serverless environments.
 *
 * ServerProvider supports both Node.js HTTP requests and Web (Fetch API) requests.
 */
export class ServerProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly router = $inject(ServerRouterProvider);

  protected readonly internalServerErrorMessage = "Internal Server Error";

  // Pre-allocated error response to avoid object creation per failed request
  protected readonly internalErrorResponse = Object.freeze({
    status: 500,
    headers: Object.freeze({ "content-type": "text/plain" }),
    body: this.internalServerErrorMessage,
  });

  // Pre-bound error handler to avoid function allocation per request
  protected readonly handleInternalError = () => this.internalErrorResponse;

  // ============================================================================
  // P1: URL Base Cache - cache protocol+host per unique host header
  // Avoids string concatenation on every request
  // ============================================================================
  protected readonly urlBaseCache = new Map<string, string>();

  /**
   * Get cached URL base (protocol + host) for a given host header.
   * Caches the result to avoid repeated string concatenation.
   */
  protected getUrlBase(headers: Record<string, string>): string {
    const host = headers[HEADER_HOST];
    let base = this.urlBaseCache.get(host);
    if (!base) {
      const proto =
        headers[HEADER_X_FORWARDED_PROTO] === "https"
          ? PROTO_HTTPS
          : PROTO_HTTP;
      base = proto + host;
      // Limit cache size to prevent memory leaks from many unique hosts
      if (this.urlBaseCache.size < 100) {
        this.urlBaseCache.set(host, base);
      }
    }
    return base;
  }

  // ============================================================================
  // P0: Manual Query String Parser - faster than URLSearchParams
  // Parses query string without creating URL object
  // ============================================================================

  /**
   * Parse query string manually - faster than new URL() + URLSearchParams.
   * Returns empty object if no query string.
   */
  protected parseQueryString(rawUrl: string): Record<string, string> {
    const qIndex = rawUrl.indexOf("?");
    if (qIndex === -1) {
      return {};
    }

    const qs = rawUrl.slice(qIndex + 1);
    if (!qs) {
      return {};
    }

    const query: Record<string, string> = {};
    let start = 0;
    let eqIdx = -1;

    for (let i = 0; i <= qs.length; i++) {
      const char = i < qs.length ? qs.charCodeAt(i) : 38; // '&' at end

      if (char === 61) {
        // '='
        eqIdx = i;
      } else if (char === 38) {
        // '&'
        if (eqIdx !== -1 && eqIdx > start) {
          const key = qs.slice(start, eqIdx);
          const value = qs.slice(eqIdx + 1, i);
          // Only decode if necessary (contains % or +)
          query[this.fastDecode(key)] = this.fastDecode(value);
        }
        start = i + 1;
        eqIdx = -1;
      }
    }

    return query;
  }

  /**
   * Fast decode - only calls decodeURIComponent if needed.
   */
  protected fastDecode(str: string): string {
    // Fast path: no encoding needed
    if (str.indexOf("%") === -1 && str.indexOf("+") === -1) {
      return str;
    }
    // Replace + with space before decoding
    try {
      return decodeURIComponent(str.replace(/\+/g, " "));
    } catch {
      return str;
    }
  }

  public get hostname(): string {
    if (this.alepha.isViteDev()) {
      return `http://localhost:${this.alepha.env.SERVER_PORT}`;
    }
    return ""; // no hostname in serverless mode
  }

  /**
   * When a Node.js HTTP request is received from outside. (Vercel, AWS Lambda, etc.)
   */
  protected readonly onNodeRequest = $hook({
    on: "node:request",
    handler: (ev) => this.handleNodeRequest(ev),
  });

  /**
   * When a Web (Fetch API) request is received from outside. (Netlify, Cloudflare Workers, etc.)
   */
  protected readonly onWebRequest = $hook({
    on: "web:request",
    handler: (ev) => {
      return this.handleWebRequest(ev);
    },
  });

  /**
   * Handle Node.js HTTP request event.
   *
   * Optimized to avoid expensive URL parsing when possible.
   */
  public async handleNodeRequest(
    nodeRequestEvent: NodeRequestEvent,
  ): Promise<void> {
    const { req, res } = nodeRequestEvent;
    const rawUrl = req.url!;
    const { route, params } = this.router.match(`/${req.method}${rawUrl}`);

    if (!route) {
      // Skip if response was already sent (e.g., by Vite middleware)
      if (res.headersSent) {
        return;
      }
      // if no route is found, return basic 404
      // note: you should not use this in production, use a custom 404 page instead by adding a route /*
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const headers = (req.headers ?? {}) as Record<string, string>;
    const method = (req.method?.toUpperCase() ?? "GET") as RouteMethod;

    // P0: Use manual query parsing - much faster than new URL() + URLSearchParams
    const query = this.parseQueryString(rawUrl);

    // P1: Use cached URL base - avoids string concat on every request
    // Create URL object (still needed for downstream code that uses url.pathname, etc.)
    const urlBase = this.getUrlBase(headers);
    const url = new URL(rawUrl, urlBase);

    const request: ServerRequestData = {
      method,
      url,
      headers,
      params: params ?? {},
      query,
      raw: { node: nodeRequestEvent },
    };

    const response = await route
      .handler(request)
      .catch(this.handleInternalError);

    // Skip if response was already sent (e.g., by Vite middleware)
    if (res.headersSent) {
      return;
    }

    // empty body - just send status & headers
    if (!response.body) {
      res.writeHead(response.status, response.headers);
      res.end();
      return;
    }

    // if response.body is string or buffer
    if (typeof response.body === "string" || Buffer.isBuffer(response.body)) {
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      return;
    }

    // if response.body is node stream
    if (response.body instanceof Readable) {
      res.writeHead(response.status, response.headers);
      response.body.pipe(res);
      return;
    }

    // if response.body is web stream
    if (response.body instanceof ReadableStream) {
      res.writeHead(response.status, response.headers);
      // Flush headers immediately and disable Nagle's algorithm for streaming
      res.flushHeaders();
      res.socket?.setNoDelay(true);
      try {
        for await (const chunk of response.body) {
          const canContinue = res.write(chunk);
          // If the internal buffer is full, wait for it to drain
          if (!canContinue) {
            await new Promise<void>((resolve) => res.once("drain", resolve));
          }
        }
      } catch (error) {
        this.log.error("Error piping proxy response stream", error);
      } finally {
        res.end();
      }
      return;
    }

    // not supported response body type

    this.log.error("Unknown response body type:", typeof response.body);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(this.internalServerErrorMessage);
  }

  /**
   * Handle Web (Fetch API) request event.
   */
  public async handleWebRequest(ev: WebRequestEvent): Promise<void> {
    const req = ev.req;
    const url = new URL(req.url);
    const { route, params } = this.router.match(
      `/${req.method}${url.pathname}`,
    );

    if (this.isViteNotFound(req.url, route, params)) {
      return;
    }

    if (!route) {
      // if no route is found, return basic 404
      // note: you should not use this in production, use a custom 404 page instead by adding a route /*
      ev.res = new Response("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain" },
      });
      return;
    }

    const headers: Record<string, string> = {};

    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Optimize: only parse query params if there are any
    const query = url.search
      ? Object.fromEntries(url.searchParams.entries())
      : {};
    const method = (req.method.toUpperCase() ?? "GET") as RouteMethod;
    const request: ServerRequestData = {
      method,
      url,
      headers,
      params: params || {},
      query,
      raw: { web: ev },
    };

    const response = await route
      .handler(request)
      .catch(this.handleInternalError);

    const webHeaders = this.toWebHeaders(response.headers);

    // empty body - just send status & headers
    if (!response.body) {
      ev.res = new Response(null, {
        status: response.status,
        headers: webHeaders,
      });
      return;
    }

    // if response.body is string or buffer
    if (typeof response.body === "string") {
      ev.res = new Response(response.body, {
        status: response.status,
        headers: webHeaders,
      });
      return;
    }

    if (Buffer.isBuffer(response.body)) {
      // Use Uint8Array to avoid Buffer pooling issues where .buffer returns
      // the entire underlying ArrayBuffer which may be larger than the actual data
      ev.res = new Response(new Uint8Array(response.body), {
        status: response.status,
        headers: webHeaders,
      });
      return;
    }

    // if response.body is node stream
    if (response.body instanceof Readable) {
      ev.res = new Response(
        Readable.toWeb(response.body) as unknown as ReadableStream,
        {
          status: response.status,
          headers: webHeaders,
        },
      );
      return;
    }

    // if response.body is web stream
    if (response.body instanceof ReadableStream) {
      ev.res = new Response(response.body, {
        status: response.status,
        headers: webHeaders,
      });
      return;
    }

    // not supported response body type
    this.log.error(`Unknown response body type: ${typeof response.body}`);
    ev.res = new Response(this.internalServerErrorMessage, {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  }

  /**
   * Convert response headers to Web API Headers.
   *
   * The `set-cookie` header requires special handling because it's stored
   * as `string[]` (one entry per cookie) but the `Response` constructor
   * would comma-join arrays, which breaks cookie parsing. We use
   * `Headers.append()` to emit each cookie as a separate header.
   */
  protected toWebHeaders(headers: Record<string, string | string[]>): Headers {
    const webHeaders = new Headers();
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          webHeaders.append(key, v);
        }
      } else {
        webHeaders.set(key, value);
      }
    }
    return webHeaders;
  }

  /**
   * Helper for Vite development mode to let Vite handle (or not) 404.
   */
  protected isViteNotFound(
    url?: string,
    route?: Route,
    params?: Record<string, string>,
  ): boolean {
    if (this.alepha.isViteDev()) {
      if (!route) {
        return true;
      }

      url = url?.split("?")[0];

      if (!!params?.["*"] && `/${params?.["*"]}` === url) {
        return true;
      }
    }

    return false;
  }
}
