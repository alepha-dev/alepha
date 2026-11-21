import { $hook, $inject, Alepha } from "alepha";
import { $cache } from "alepha/cache";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { ServerRequest, ServerRoute } from "alepha/server";

import type { EtagMiddlewareOptionsResolved } from "../primitives/$etag.ts";

// ---------------------------------------------------------------------------------------------------------------------

export class ServerEtagProvider {
  /**
   * The quoted part of an entity-tag (RFC 9110 section 8.8.3): any visible
   * character but the double quote, so a comma inside one is not a separator.
   */
  protected static readonly OPAQUE_TAG = /"[\x21\x23-\x7E\x80-\uFFFF]*"/g;

  /**
   * A whole `If-None-Match` value that is a list of entity-tags, each with
   * an optional `W/` (exact case).
   */
  protected static readonly ENTITY_TAG_LIST =
    /^(?:W\/)?"[\x21\x23-\x7E\x80-\uFFFF]*"(?:[ \t]*,[ \t]*(?:W\/)?"[\x21\x23-\x7E\x80-\uFFFF]*")*$/;

  /**
   * IMF-fixdate (RFC 9110 section 5.6.7), the HTTP-date this provider writes
   * and the only form it reads.
   */
  protected static readonly HTTP_DATE =
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly time = $inject(DateTimeProvider);
  protected readonly cache = $cache<RouteCacheEntry>({
    provider: "memory",
    name: "http:server",
  });

  public async generateETag(content: string | Buffer): Promise<string> {
    const data = typeof content === "string" ? content : content.toString();
    return `"${(await this.crypto.hash(data)).slice(0, 32)}"`;
  }

  public async invalidate(route: ServerRoute) {
    // Wildcard: entries are keyed by route + params + query + caller identity,
    // so one route holds as many entries as it was asked distinct questions.
    await this.cache.invalidate(`${this.createRouteKey(route)}*`);
  }

  /**
   * Whether an `If-None-Match` header names `etag`, by the weak comparison
   * RFC 9110 section 13.1.2 asks of a conditional GET: a `W/` prefix on
   * either side is ignored. A proxy or CDN that compresses a response weakens
   * its ETag, so an exact string comparison never answers 304 behind one.
   *
   * The header is `*` alone, or a comma-separated list of entity-tags. One
   * that is neither is malformed and matches nothing.
   */
  public matchesIfNoneMatch(
    header: string | string[] | undefined,
    etag: string,
  ): boolean {
    if (!header) {
      return false;
    }

    const value = (Array.isArray(header) ? header.join(",") : header).trim();
    if (value === "*") {
      return true;
    }

    if (!ServerEtagProvider.ENTITY_TAG_LIST.test(value)) {
      return false;
    }

    const opaque = etag.startsWith("W/") ? etag.slice(2) : etag;
    for (const [candidate] of value.matchAll(ServerEtagProvider.OPAQUE_TAG)) {
      if (candidate === opaque) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check cache for a stored response. Returns the cached body if found, undefined otherwise.
   * Called by the $etag() middleware before the handler runs.
   */
  public async checkCache(
    request: ServerRequest,
    options: EtagMiddlewareOptionsResolved,
  ): Promise<any> {
    if (!this.shouldStore(options)) {
      return undefined;
    }

    // Build key from route metadata (set by ServerRouterProvider before handler)
    // or from action request context (for .run() direct calls). `"fork"`, as
    // in the `$etag` middleware: an enclosing action's request is not ours.
    const actionRequest = this.alepha.store.get(
      "alepha.action.request",
      "fork",
    );

    const keySource = {
      method:
        request.metadata?.routeMethod ??
        actionRequest?.method ??
        request.method ??
        "GET",
      path:
        request.metadata?.routePath ??
        String(actionRequest?.url ?? request.url ?? ""),
    } as ServerRoute;

    const key = await this.createCacheKey(keySource, actionRequest ?? request);
    const cached = await this.cache.get(key);

    if (!cached) {
      this.log.trace("Cache miss", { key });
      return undefined;
    }

    this.log.trace("Cache hit", { key });

    // Mark as cache hit in request metadata
    request.metadata ??= {};
    request.metadata.etagHit = true;

    // For HTTP routes, set reply headers
    if (request.reply) {
      if (this.isNotModified(request, cached.hash, cached.lastModified)) {
        request.reply.status = 304;
        request.reply.setHeader("etag", cached.hash);
        request.reply.setHeader("last-modified", cached.lastModified);
        this.log.trace("ETag match, returning 304", {
          key,
          etag: cached.hash,
        });
        return request.reply.body;
      }

      request.reply.body = cached.body;
      request.reply.status = cached.status ?? 200;

      if (cached.contentType) {
        request.reply.setHeader("Content-Type", cached.contentType);
      }

      request.reply.setHeader("etag", cached.hash);
      request.reply.setHeader("last-modified", cached.lastModified);
    }

    // For action direct invocations, return body
    const body =
      cached.contentType === "application/json"
        ? JSON.parse(cached.body)
        : cached.body;

    return body;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Hooks (post-handler, read from request.metadata)
  // -------------------------------------------------------------------------------------------------------------------

  /**
   * After an action response, store it in cache if store is enabled.
   */
  protected readonly onActionResponse = $hook({
    on: "action:response:after",
    handler: async ({ action, request, response }) => {
      const options = request.metadata
        ?.etagOptions as EtagMiddlewareOptionsResolved;
      if (!options || !this.shouldStore(options)) {
        return;
      }

      // Skip if this was a cache hit (don't re-store)
      if (request.metadata?.etagHit) {
        return;
      }

      // Don't cache error responses (status >= 400)
      if (request.reply.status && request.reply.status >= 400) {
        return;
      }

      if (!response) {
        return;
      }

      const contentType =
        typeof response === "string" ? "text/plain" : "application/json";
      const body =
        contentType === "text/plain" ? response : JSON.stringify(response);

      const generatedEtag = await this.generateETag(body);
      const lastModified = this.httpDate();

      const key = await this.createCacheKey(action.route, request);

      this.log.trace("Storing action response", {
        key,
        action: action.name,
      });

      await this.cache.set(
        key,
        {
          body: body,
          lastModified,
          contentType: contentType,
          hash: generatedEtag,
        },
        this.resolveStoreTtl(options),
      );

      // Set Cache-Control header if configured
      const cacheControl = this.buildCacheControlHeader(options);
      if (cacheControl) {
        request.reply.setHeader("cache-control", cacheControl);
      }
    },
  });

  /**
   * Before sending the response, check ETag for etag-only routes.
   * This handles the case where etag is enabled but store is not.
   */
  protected readonly onSend = $hook({
    on: "server:response:before",
    handler: async ({ request }) => {
      const options = request.metadata
        ?.etagOptions as EtagMiddlewareOptionsResolved;
      if (!options) {
        return;
      }

      const shouldStore = this.shouldStore(options);
      const shouldUseEtag = this.shouldUseEtag(options);

      if (request.reply.headers.etag) {
        // ETag already set, skip
        return;
      }

      // Strings only, as in `onResponse` below: no other body is ever sent
      // with an ETag, so there is no validator a client could send back.
      if (
        !shouldStore &&
        shouldUseEtag &&
        typeof request.reply.body === "string"
      ) {
        const generatedEtag = await this.generateETag(request.reply.body);

        if (this.isNotModified(request, generatedEtag)) {
          request.reply.status = 304;
          request.reply.body = undefined;
          request.reply.setHeader("etag", generatedEtag);
          this.log.trace("ETag match on send, returning 304", {
            route: request.url,
            etag: generatedEtag,
          });
          return;
        }
      }
    },
  });

  /**
   * After the response is generated, store it and set ETag headers.
   */
  protected readonly onResponse = $hook({
    on: "server:response:after",
    priority: "first",
    handler: async ({ route, request, response }) => {
      const options = request.metadata
        ?.etagOptions as EtagMiddlewareOptionsResolved;
      if (!options) {
        return;
      }

      // Initialize headers if not present
      response.headers ??= {};

      // Error responses get NOTHING from this middleware, not even the
      // Cache-Control header. The directive describes the route, not the
      // outcome, so a route declaring `public, max-age=1y, immutable` used to
      // hand that to its own 404s: the header was set here, above the guard
      // below, which only ever skipped the store/etag work. Every browser that
      // saw one transient failure then pinned it for a year.
      if (response.status && response.status >= 400) {
        return;
      }

      // Set Cache-Control header if configured
      const cacheControl = this.buildCacheControlHeader(options);
      if (cacheControl) {
        response.headers["cache-control"] = cacheControl;
      }

      const shouldStore = this.shouldStore(options);
      const shouldUseEtag = this.shouldUseEtag(options);

      // Skip if neither cache nor etag is enabled
      if (!shouldStore && !shouldUseEtag) {
        return;
      }

      // Skip if this was a cache hit (don't re-store)
      if (request.metadata?.etagHit) {
        return;
      }

      const key = await this.createCacheKey(route, request);

      // Handle ReadableStream responses (e.g., SSR streaming)
      if (response.body instanceof ReadableStream && shouldStore) {
        // Tee the stream: one for client, one for cache collection
        const [clientStream, cacheStream] = (
          response.body as ReadableStream<Uint8Array>
        ).tee();

        // Replace response body with client stream (continues streaming to client)
        response.body = clientStream as typeof response.body;

        // Collect cache stream in background (non-blocking)
        this.collectStreamForCache(
          cacheStream,
          key,
          response.status,
          response.headers?.["content-type"],
          shouldUseEtag,
          this.resolveStoreTtl(options),
        )
          .then((hash) => {
            if (shouldUseEtag && hash) {
              this.log.trace("Stream cached with hash", { key, hash });
            }
          })
          .catch((err) => {
            this.log.warn("Failed to cache stream", { key, error: err });
          });

        return;
      }

      // Only process string responses (text, html, json, etc.)
      if (typeof response.body !== "string") {
        return;
      }

      const generatedEtag = await this.generateETag(response.body);
      const lastModified = this.httpDate();

      // Store response if storing is enabled
      if (shouldStore) {
        this.log.trace("Storing response", {
          key,
          route: route.path,
          etag: shouldUseEtag,
        });

        await this.cache.set(
          key,
          {
            body: response.body,
            status: response.status,
            contentType: response.headers?.["content-type"],
            lastModified,
            hash: generatedEtag,
          },
          this.resolveStoreTtl(options),
        );
      }

      // Set ETag headers if etag is enabled
      if (shouldUseEtag) {
        response.headers.etag = generatedEtag;

        // The time the entry was stored, which every later hit repeats. A
        // route that stores nothing has no such time: "now" on each response
        // would tell a cache the resource never stops changing.
        if (shouldStore) {
          response.headers["last-modified"] = lastModified;
        }
      }
    },
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Public helpers
  // -------------------------------------------------------------------------------------------------------------------

  public buildCacheControlHeader(
    options?: EtagMiddlewareOptionsResolved,
  ): string | undefined {
    if (!options) {
      return undefined;
    }

    const control = options.control;
    if (!control) {
      return undefined;
    }

    // If control is a string, return it directly
    if (typeof control === "string") {
      return control;
    }

    // If control is true, return default Cache-Control
    if (control === true) {
      return "public, max-age=300";
    }

    // Build Cache-Control from object directives
    const directives: string[] = [];

    if (control.public) {
      directives.push("public");
    }
    if (control.private) {
      directives.push("private");
    }
    if (control.noCache) {
      directives.push("no-cache");
    }
    if (control.noStore) {
      directives.push("no-store");
    }
    if (control.maxAge !== undefined) {
      const maxAgeSeconds = this.durationToSeconds(control.maxAge);
      directives.push(`max-age=${maxAgeSeconds}`);
    }
    if (control.sMaxAge !== undefined) {
      const sMaxAgeSeconds = this.durationToSeconds(control.sMaxAge);
      directives.push(`s-maxage=${sMaxAgeSeconds}`);
    }
    if (control.mustRevalidate) {
      directives.push("must-revalidate");
    }
    if (control.proxyRevalidate) {
      directives.push("proxy-revalidate");
    }
    if (control.immutable) {
      directives.push("immutable");
    }
    if (control.staleWhileRevalidate !== undefined) {
      const seconds = this.durationToSeconds(control.staleWhileRevalidate);
      directives.push(`stale-while-revalidate=${seconds}`);
    }

    return directives.length > 0 ? directives.join(", ") : undefined;
  }

  public shouldStore(options?: EtagMiddlewareOptionsResolved): boolean {
    if (!options) return false;
    if (options.store) return true;
    return false;
  }

  /**
   * TTL configured on `store`, in whatever form it was written:
   * `store: true` (no TTL: the cache default applies), a bare duration, or
   * `{ ttl }`. It used to be truth-tested and then dropped, so every stored
   * response silently fell back to the global cache default.
   */
  public resolveStoreTtl(
    options?: EtagMiddlewareOptionsResolved,
  ): DurationLike | undefined {
    const store = options?.store;

    if (!store || store === true) {
      return undefined;
    }

    if (typeof store === "number" || Array.isArray(store)) {
      return store;
    }

    // A `Duration` instance is a DurationLike; a CachePrimitiveOptions is not
    // and carries the duration under `ttl`.
    if (typeof store === "object" && "ttl" in store) {
      return store.ttl;
    }

    return store as DurationLike;
  }

  public shouldUseEtag(options?: EtagMiddlewareOptionsResolved): boolean {
    if (!options) return false;
    if (options.etag) return true;
    return false;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Protected helpers
  // -------------------------------------------------------------------------------------------------------------------

  protected durationToSeconds(duration: number | DurationLike): number {
    if (typeof duration === "number") {
      return duration;
    }

    return this.time.duration(duration).asSeconds();
  }

  /**
   * The current time as an HTTP-date (RFC 9110 section 5.6.7), the only form
   * `Last-Modified` and `If-Modified-Since` take.
   */
  protected httpDate(): string {
    return new Date(this.time.nowMillis()).toUTCString();
  }

  /**
   * Whether the conditional headers of `request` say the client already
   * holds this response. `If-None-Match` wins when it is sent, and
   * `If-Modified-Since` is then ignored (RFC 9110 section 13.1.3).
   */
  protected isNotModified(
    request: ServerRequest,
    etag: string,
    lastModified?: string,
  ): boolean {
    const ifNoneMatch = request.headers?.["if-none-match"];
    if (ifNoneMatch) {
      return this.matchesIfNoneMatch(ifNoneMatch, etag);
    }

    const ifModifiedSince = request.headers?.["if-modified-since"];
    if (!ifModifiedSince || !lastModified) {
      return false;
    }

    // A value that is not an HTTP-date is ignored, as the RFC asks:
    // `Date.parse` alone would read "2099" or an ISO string as a date.
    const since = String(ifModifiedSince).trim();
    if (!ServerEtagProvider.HTTP_DATE.test(since)) {
      return false;
    }

    // NaN for a well-formed date that does not exist, and NaN compares false.
    return Date.parse(lastModified) <= Date.parse(since);
  }

  /**
   * The part of a store key every entry of one route starts with, which is
   * what `invalidate()` clears. The `:` separators cannot come out of
   * `encodeURIComponent`, so the path cannot spill into the next component.
   */
  protected createRouteKey(route: ServerRoute): string {
    return `${route.method}:${encodeURIComponent(route.path ?? "")}:`;
  }

  /**
   * The store key of one request: route, then path parameters and query,
   * then caller identity.
   *
   * It must be injective, since two requests sharing a key are served each
   * other's body, and anonymous callers share entries: anyone could plant
   * one. Parameters and query are therefore kept as two separate objects,
   * serialized as JSON (names and values quoted and escaped, so no value can
   * spell out a second parameter), and percent-encoded so the result holds
   * no `:` of its own. JSON has no bigint, so a bigint and every string are
   * written with a tag (`n:` and `s:`), which keeps `5n` apart from `"5n"`.
   */
  protected async createCacheKey(
    route: ServerRoute,
    config?: ServerRequest,
  ): Promise<string> {
    const input = JSON.stringify(
      [config?.params ?? {}, config?.query ?? {}],
      (_key, value) =>
        typeof value === "bigint"
          ? `n:${value}`
          : typeof value === "string"
            ? `s:${value}`
            : value,
    );

    return `${this.createRouteKey(route)}${encodeURIComponent(input)}${await this.identityScope(config)}`;
  }

  /**
   * Namespaces the cache entry by caller identity.
   *
   * The key is otherwise route + params + query, so `$etag(true)` on an
   * authenticated action would store the first caller's body and serve it to
   * everyone else. Anonymous callers (no authorization, no cookie) share one
   * entry, which is the intended behaviour for public routes.
   */
  protected async identityScope(config?: ServerRequest): Promise<string> {
    const headers = config?.headers as Record<string, string> | undefined;

    const auth = headers?.authorization ?? "";
    const cookie = headers?.cookie ?? "";

    if (!auth && !cookie) {
      return "";
    }

    return `:${(await this.crypto.hash(`${auth}${cookie}`)).slice(0, 32)}`;
  }

  /**
   * Collect a ReadableStream into a string and store it in the cache.
   * This runs in the background while the original stream is sent to the client.
   */
  protected async collectStreamForCache(
    stream: ReadableStream<Uint8Array>,
    key: string,
    status: number | undefined,
    contentType: string | undefined,
    generateEtag: boolean,
    ttl?: DurationLike,
  ): Promise<string | undefined> {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Combine chunks into a single string
      const decoder = new TextDecoder();
      const body =
        chunks
          .map((chunk) => decoder.decode(chunk, { stream: true }))
          .join("") + decoder.decode(); // Flush remaining

      const hash = await this.generateETag(body);
      const lastModified = this.httpDate();

      this.log.trace("Storing streamed response", { key });

      await this.cache.set(
        key,
        {
          body,
          status,
          contentType,
          lastModified,
          hash,
        },
        ttl,
      );

      return generateEtag ? hash : undefined;
    } finally {
      reader.releaseLock();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------

interface RouteCacheEntry {
  contentType?: string;
  body: any;
  status?: number;
  lastModified: string;
  hash: string;
}
