import { AlephaError } from "alepha";
import type { DurationLike } from "alepha/datetime";

import { HttpClient } from "./HttpClient.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * In-memory stand-in for {@link HttpClient}: the calls an app makes to an
 * external API are answered by routes registered in the test, recorded, and
 * an unexpected one fails.
 *
 * Only the transport is replaced. The timeout, ambient cancellation, dedup,
 * the cache, the `client` span, error mapping and schema decoding all run as
 * they do against the network, so a spec can prove them.
 *
 * A call to the app's own origin (a relative URL, the page's origin in the
 * browser, the listening server on loopback) reaches the real `fetch` unless
 * a route matches it: `$action.fetch()`, the link registry and `/api/_batch`
 * keep working. Every other unmatched call rejects, naming method and URL.
 *
 * Only calls made through `HttpClient` are seen. Code calling the global
 * `fetch` directly is not intercepted, and the global `fetch` is never
 * patched.
 *
 * @example
 * ```typescript
 * const alepha = Alepha.create().with({ provide: HttpClient, use: MemoryHttpClient });
 * const http = alepha.inject(MemoryHttpClient);
 *
 * http.on("GET", "https://api.example.com/customers/:id", ({ params }) => ({
 *   id: params.id,
 * }));
 *
 * // ... run the code under test ...
 *
 * expect(http.calls("GET", "https://api.example.com/customers/:id")).toHaveLength(1);
 * ```
 */
export class MemoryHttpClient extends HttpClient {
  /**
   * Every call answered by a route or refused, oldest first. Calls passed
   * through to the app's own origin are not recorded.
   */
  public readonly recorded: MemoryHttpCall[] = [];

  protected readonly routes: MemoryHttpRoute[] = [];

  protected readonly extraOrigins = new Set<string>();

  /**
   * Answer `method` requests whose URL matches `pattern`.
   *
   * `pattern` is an absolute URL whose path may hold `:name` segments,
   * captured into `params`, and a trailing `*`. The query string is never
   * part of the match. `method` is case-insensitive; `"*"` matches any.
   *
   * The handler returns the response data (an object or an array is sent as
   * JSON, a string as text, `undefined` as a 204), or a `Response` for full
   * control over the status and headers. A handler that throws makes the
   * call fail as a network error does, with that error.
   *
   * The most recently registered matching route wins, so a spec can
   * override a default set in a `beforeEach`.
   */
  public on(
    method: string,
    pattern: string,
    handler: MemoryHttpHandler,
    options: MemoryHttpRouteOptions = {},
  ): this {
    this.routes.unshift({
      method: method.toUpperCase(),
      pattern,
      matcher: this.compile(pattern),
      handler,
      options,
    });
    return this;
  }

  /**
   * The recorded calls, optionally only those of `method` matching
   * `pattern` (the same syntax as {@link on}).
   */
  public calls(method?: string, pattern?: string): MemoryHttpCall[] {
    const wanted = method?.toUpperCase();
    const matcher = pattern ? this.compile(pattern) : undefined;
    return this.recorded.filter(
      (call) =>
        (!wanted || wanted === "*" || call.method === wanted) &&
        (!matcher || this.match(matcher, new URL(call.url)) !== undefined),
    );
  }

  /**
   * Whether a call of `method` matching `pattern` was made.
   */
  public wasCalled(method: string, pattern: string): boolean {
    return this.calls(method, pattern).length > 0;
  }

  /**
   * Treat `origin` (`http://localhost:4000`) as the app's own: an unmatched
   * call to it reaches the real `fetch`.
   */
  public passThrough(origin: string): this {
    this.extraOrigins.add(new URL(origin).origin);
    return this;
  }

  /**
   * Forget every route and every recorded call.
   */
  public reset(): this {
    this.routes.length = 0;
    this.recorded.length = 0;
    return this;
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected override async transport(
    url: string,
    request: RequestInit,
  ): Promise<Response> {
    const method = (request.method ?? "GET").toUpperCase();
    const absolute = this.absolute(url);

    let found:
      | { route: MemoryHttpRoute; params: Record<string, string> }
      | undefined;
    for (const route of this.routes) {
      if (route.method !== "*" && route.method !== method) {
        continue;
      }
      const params = absolute ? this.match(route.matcher, absolute) : undefined;
      if (params) {
        found = { route, params };
        break;
      }
    }

    if (!found || !absolute) {
      if (!absolute || this.isOwnOrigin(absolute)) {
        return super.transport(url, request);
      }
      const call = await this.record(method, absolute, {}, request);
      call.matched = false;
      throw new AlephaError(
        `MemoryHttpClient: no route for ${method} ${absolute.href}`,
      );
    }

    const { route, params } = found;
    const call = await this.record(method, absolute, params, request);
    call.matched = true;

    if (route.options.delay !== undefined) {
      await this.delay(route.options.delay, request.signal ?? undefined);
    }

    const result = await route.handler(call);
    if (result instanceof Response) {
      return result;
    }
    return this.toResponse(result, route.options);
  }

  /**
   * Wait `duration` on `DateTimeProvider`'s clock, so `travel()` drives it,
   * rejecting with the signal's reason if the caller leaves first.
   */
  protected async delay(
    duration: DurationLike,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    signal?.throwIfAborted();
    await this.dateTime.wait(duration, { signal });
    signal?.throwIfAborted();
  }

  protected toResponse(
    data: unknown,
    options: MemoryHttpRouteOptions,
  ): Response {
    const status = options.status ?? (data === undefined ? 204 : 200);
    const headers = new Headers(options.headers);
    if (data === undefined || status === 204 || status === 304) {
      return new Response(null, { status, headers });
    }
    if (typeof data === "string") {
      if (!headers.has("content-type")) {
        headers.set("content-type", "text/plain; charset=utf-8");
      }
      return new Response(data, { status, headers });
    }
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new Response(JSON.stringify(data), { status, headers });
  }

  protected async record(
    method: string,
    url: URL,
    params: Record<string, string>,
    request: RequestInit,
  ): Promise<MemoryHttpCall> {
    const headers: Record<string, string> = {};
    new Headers(request.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: MemoryHttpCall = {
      method,
      url: url.href,
      params,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
      body: await this.readBody(request.body, headers["content-type"]),
      matched: false,
    };
    this.recorded.push(call);
    return call;
  }

  /**
   * The request body as the handler wants it: JSON decoded, text as is, a
   * `FormData` or a binary body untouched.
   */
  protected async readBody(
    body: RequestInit["body"],
    contentType: string | undefined,
  ): Promise<unknown> {
    if (body === undefined || body === null) {
      return undefined;
    }
    if (typeof body === "string") {
      if (contentType?.startsWith("application/json")) {
        try {
          return JSON.parse(body);
        } catch {
          return body;
        }
      }
      return body;
    }
    return body;
  }

  protected absolute(url: string): URL | undefined {
    try {
      return new URL(url);
    } catch {
      return undefined;
    }
  }

  /**
   * Whether `url` is the app's own origin: the page's in the browser, the
   * listening server's on loopback, or one given to {@link passThrough}.
   */
  protected isOwnOrigin(url: URL): boolean {
    if (this.extraOrigins.has(url.origin)) {
      return true;
    }
    if (this.alepha.isBrowser()) {
      return url.origin === globalThis.location?.origin;
    }
    if (!this.loopback.has(url.hostname)) {
      return false;
    }
    const port = this.ownPort();
    return port !== undefined && Number(url.port) === port;
  }

  protected readonly loopback = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "[::1]",
    "::1",
  ]);

  /**
   * The port the app's own server listens on, when there is one.
   */
  protected ownPort(): number | undefined {
    const server = this.alepha.store.get("alepha.node.server" as any) as
      | { address?: () => unknown }
      | undefined;
    const address = server?.address?.();
    if (address && typeof address === "object" && "port" in address) {
      return Number((address as { port: number }).port);
    }
    const port = Number(this.alepha.env.SERVER_PORT);
    return Number.isFinite(port) && port > 0 ? port : undefined;
  }

  protected compile(pattern: string): MemoryHttpMatcher {
    const url = new URL(pattern.replace(/\*$/, "__wildcard__"));
    const wildcard = url.pathname.endsWith("__wildcard__");
    const path = wildcard
      ? url.pathname.slice(0, -"__wildcard__".length)
      : url.pathname;
    const segments = path.split("/").filter((s) => s !== "");
    return { origin: url.origin, segments, wildcard };
  }

  protected match(
    matcher: MemoryHttpMatcher,
    url: URL,
  ): Record<string, string> | undefined {
    if (url.origin !== matcher.origin) {
      return undefined;
    }
    const segments = url.pathname.split("/").filter((s) => s !== "");
    if (
      matcher.wildcard
        ? segments.length < matcher.segments.length
        : segments.length !== matcher.segments.length
    ) {
      return undefined;
    }
    const params: Record<string, string> = {};
    for (let i = 0; i < matcher.segments.length; i++) {
      const expected = matcher.segments[i];
      const actual = segments[i];
      if (expected.startsWith(":")) {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected !== actual) {
        return undefined;
      }
    }
    return params;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A call {@link MemoryHttpClient} answered or refused.
 */
export interface MemoryHttpCall {
  /**
   * Upper case.
   */
  method: string;
  url: string;
  /**
   * The `:name` segments of the matching route.
   */
  params: Record<string, string>;
  query: Record<string, string>;
  /**
   * Lower-cased names.
   */
  headers: Record<string, string>;
  /**
   * A JSON body decoded, a text body as is, anything else as sent.
   */
  body: unknown;
  /**
   * `false` when no route matched and the call was refused.
   */
  matched: boolean;
}

/**
 * Answers a call: the response data, or a `Response`.
 */
export type MemoryHttpHandler = (call: MemoryHttpCall) => unknown;

export interface MemoryHttpRouteOptions {
  /**
   * Status of a data response. Defaults to 200, or 204 for `undefined`.
   */
  status?: number;
  /**
   * Headers of a data response.
   */
  headers?: HeadersInit;
  /**
   * Simulated latency before the handler runs, on `DateTimeProvider`'s
   * clock: `travel()` moves past it, and the call's own timeout can fire
   * first.
   */
  delay?: DurationLike;
}

interface MemoryHttpMatcher {
  origin: string;
  segments: string[];
  wildcard: boolean;
}

interface MemoryHttpRoute {
  method: string;
  pattern: string;
  matcher: MemoryHttpMatcher;
  handler: MemoryHttpHandler;
  options: MemoryHttpRouteOptions;
}
