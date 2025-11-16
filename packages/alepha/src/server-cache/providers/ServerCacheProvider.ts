import { createHash } from "node:crypto";
import { $cache, type CacheDescriptorOptions } from "alepha/cache";
import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  ActionDescriptor,
  type RequestConfigSchema,
  type ServerRequest,
  type ServerRoute,
} from "alepha/server";

declare module "alepha/server" {
  interface ServerRoute {
    /**
     * Enable caching for this route.
     * - If true: enables both store and etag
     * - If object: fine-grained control over store, etag, and cache-control headers
     *
     * @default false
     */
    cache?: ServerRouteCache;
  }

  interface ActionDescriptor<TConfig extends RequestConfigSchema> {
    invalidate: () => Promise<void>;
  }
}

ActionDescriptor.prototype.invalidate = async function (
  this: ActionDescriptor<RequestConfigSchema>,
) {
  await this.alepha.inject(ServerCacheProvider).invalidate(this.route);
};

export class ServerCacheProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly time = $inject(DateTimeProvider);
  protected readonly cache = $cache<RouteCacheEntry>({
    provider: "memory",
  });

  public generateETag(content: string): string {
    return `"${createHash("md5").update(content).digest("hex")}"`;
  }

  public async invalidate(route: ServerRoute) {
    const cache = route.cache;
    if (!cache) {
      return;
    }

    await this.cache.invalidate(this.createCacheKey(route));
  }

  protected readonly onActionRequest = $hook({
    on: "action:onRequest",
    handler: async ({ action, request }) => {
      const cache = action.route.cache;

      const shouldStore = this.shouldStore(cache);

      // Only check cache if storing is enabled
      if (shouldStore) {
        const key = this.createCacheKey(action.route, request);
        const cached = await this.cache.get(key);

        if (cached) {
          const body =
            cached.contentType === "application/json"
              ? JSON.parse(cached.body)
              : cached.body;

          this.log.trace("Cache hit for action", {
            key,
            action: action.name,
          });

          request.reply.body = body; // just re-use, full trust
        } else {
          this.log.trace("Cache miss for action", {
            key,
            action: action.name,
          });
        }
      }
    },
  });

  protected readonly onActionResponse = $hook({
    on: "action:onResponse",
    handler: async ({ action, request, response }) => {
      const cache = action.route.cache;

      const shouldStore = this.shouldStore(cache);

      if (!shouldStore || !response) {
        return;
      }

      // Don't cache error responses (status >= 400)
      if (request.reply.status && request.reply.status >= 400) {
        return;
      }

      // TODO: serialize the response body, exactly like in the server response hook
      // this is bad
      const contentType =
        typeof response === "string" ? "text/plain" : "application/json";
      const body =
        contentType === "text/plain" ? response : JSON.stringify(response);

      const generatedEtag = this.generateETag(body);
      const lastModified = this.time.toISOString();

      // Store response for cached actions
      const key = this.createCacheKey(action.route, request);

      this.log.trace("Storing response", {
        key,
        action: action.name,
      });

      await this.cache.set(key, {
        body: body,
        lastModified,
        contentType: contentType,
        hash: generatedEtag,
      });

      // Set Cache-Control header if configured (for HTTP responses)
      const cacheControl = this.buildCacheControlHeader(cache);
      if (cacheControl) {
        request.reply.setHeader("cache-control", cacheControl);
      }
    },
  });

  protected readonly onRequest = $hook({
    on: "server:onRequest",
    handler: async ({ route, request }) => {
      const cache = route.cache;

      const shouldStore = this.shouldStore(cache);
      const shouldUseEtag = this.shouldUseEtag(cache);

      // Check for cached response or ETag
      if (!shouldStore && !shouldUseEtag) {
        return;
      }

      const key = this.createCacheKey(route, request);
      const cached = await this.cache.get(key);

      if (cached) {
        // Check if client has matching ETag - return 304 for both cached and etag-only routes
        if (
          request.headers["if-none-match"] === cached.hash ||
          request.headers["if-modified-since"] === cached.lastModified
        ) {
          request.reply.status = 304;
          request.reply.setHeader("etag", cached.hash);
          request.reply.setHeader("last-modified", cached.lastModified);
          this.log.trace("ETag match, returning 304", {
            route: route.path,
            etag: cached.hash,
          });
          return;
        }

        // Only serve cached content if storing is enabled (not for etag-only routes)
        if (shouldStore) {
          this.log.trace("Cache hit for route", {
            key,
            route: route.path,
          });

          // if the cache is found, we can skip the request processing
          // and return the cached response
          request.reply.body = cached.body;
          request.reply.status = cached.status ?? 200;

          if (cached.contentType) {
            request.reply.setHeader("Content-Type", cached.contentType);
          }

          request.reply.setHeader("etag", cached.hash);
          request.reply.setHeader("last-modified", cached.lastModified);
        }
      } else if (shouldStore) {
        this.log.trace("Cache miss for route", {
          key,
          route: route.path,
        });
      }
    },
  });

  protected readonly onSend = $hook({
    on: "server:onSend",
    handler: async ({ route, request }) => {
      // before sending the response, check if the ETag matches
      // and if so, return a 304 Not Modified response
      // -> this is only relevant for etag-only routes, not cached routes <-
      const cache = route.cache;

      const shouldStore = this.shouldStore(cache);
      const shouldUseEtag = this.shouldUseEtag(cache);

      if (!shouldStore && shouldUseEtag && request.reply.body != null) {
        const generatedEtag = this.generateETag(request.reply.body);

        if (request.headers["if-none-match"] === generatedEtag) {
          request.reply.status = 304;
          request.reply.body = undefined;
          request.reply.setHeader("etag", generatedEtag);
          this.log.trace("ETag match on send, returning 304", {
            route: route.path,
            etag: generatedEtag,
          });
          return;
        }
      }
    },
  });

  protected readonly onResponse = $hook({
    on: "server:onResponse",
    priority: "first",
    handler: async ({ route, request, response }) => {
      const cache = route.cache;

      const shouldStore = this.shouldStore(cache);
      const shouldUseEtag = this.shouldUseEtag(cache);

      // Skip if neither cache nor etag is enabled
      if (!shouldStore && !shouldUseEtag) {
        return;
      }

      // Only process string responses (text, html, json, etc.)
      // Buffer is not supported by alepha/cache for now
      if (typeof response.body !== "string") {
        return;
      }

      // Don't cache error responses (status >= 400)
      if (response.status && response.status >= 400) {
        return;
      }

      const key = this.createCacheKey(route, request);
      const generatedEtag = this.generateETag(response.body);
      const lastModified = this.time.toISOString();

      // Initialize headers if not present
      response.headers ??= {};

      // Store response if storing is enabled
      if (shouldStore) {
        this.log.trace("Storing response", {
          key,
          route: route.path,
          cache: !!cache,
          etag: shouldUseEtag,
        });

        await this.cache.set(key, {
          body: response.body,
          status: response.status,
          contentType: response.headers?.["content-type"],
          lastModified,
          hash: generatedEtag,
        });

        // Set Cache-Control header if configured
        const cacheControl = this.buildCacheControlHeader(cache);
        if (cacheControl) {
          response.headers["cache-control"] = cacheControl;
        }
      }

      // Set ETag headers if etag is enabled
      if (shouldUseEtag) {
        response.headers.etag = generatedEtag;
        response.headers["last-modified"] = lastModified;
      }
    },
  });

  public buildCacheControlHeader(cache?: ServerRouteCache): string | undefined {
    if (!cache) {
      return undefined;
    }

    // If cache is true or a DurationLike, no Cache-Control header is set
    if (
      cache === true ||
      typeof cache === "string" ||
      typeof cache === "number"
    ) {
      return undefined;
    }

    const control = cache.control;
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

    return directives.length > 0 ? directives.join(", ") : undefined;
  }

  protected durationToSeconds(duration: number | DurationLike): number {
    if (typeof duration === "number") {
      return duration;
    }

    return this.time.duration(duration).asSeconds();
  }

  protected shouldStore(cache?: ServerRouteCache): boolean {
    if (!cache) return false;
    if (cache === true) return true;
    if (typeof cache === "object" && cache.store) return true;
    return false;
  }

  protected shouldUseEtag(cache?: ServerRouteCache): boolean {
    // cache: true enables etag
    if (cache === true) return true;
    // Check object form
    if (typeof cache === "object" && cache.etag) return true;
    return false;
  }

  protected createCacheKey(route: ServerRoute, config?: ServerRequest): string {
    const params: string[] = [];
    for (const [key, value] of Object.entries(config?.params ?? {})) {
      params.push(`${key}=${value}`);
    }
    for (const [key, value] of Object.entries(config?.query ?? {})) {
      params.push(`${key}=${value}`);
    }

    return `${route.method}:${route.path.replaceAll(":", "")}:${params.join(",").replaceAll(":", "")}`;
  }
}

export type ServerRouteCache =
  /**
   * If true, enables caching with:
   * - store: true
   * - etag: true
   */
  | boolean
  /**
   * Object configuration for fine-grained cache control.
   *
   * If empty, no caching will be applied.
   */
  | {
      /**
       * If true, enables storing cached responses. (in-memory, Redis, @see alepha/cache for other providers)
       * If a DurationLike is provided, it will be used as the TTL for the cache.
       * If CacheDescriptorOptions is provided, it will be used to configure the cache storage.
       *
       * @default false
       */
      store?: true | DurationLike | CacheDescriptorOptions;
      /**
       * If true, enables ETag support for the cached responses.
       */
      etag?: true;
      /**
       * - If true, sets Cache-Control to "public, max-age=300" (5 minutes).
       * - If string, sets Cache-Control to the provided value directly.
       * - If object, configures Cache-Control directives.
       */
      control?: /**
       * If true, sets Cache-Control to "public, max-age=300" (5 minutes).
       */
        | true
        /**
         * If string, sets Cache-Control to the provided value directly.
         */
        | string
        /**
         * If object, configures Cache-Control directives.
         */
        | {
            /**
             * Indicates that the response may be cached by any cache.
             */
            public?: boolean;
            /**
             * Indicates that the response is intended for a single user and must not be stored by a shared cache.
             */
            private?: boolean;
            /**
             * Forces caches to submit the request to the origin server for validation before releasing a cached copy.
             */
            noCache?: boolean;
            /**
             * Instructs caches not to store the response.
             */
            noStore?: boolean;
            /**
             * Maximum amount of time a resource is considered fresh.
             * Can be specified as a number (seconds) or as a DurationLike object.
             *
             * @example 300 // 5 minutes in seconds
             * @example { minutes: 5 } // 5 minutes
             * @example { hours: 1 } // 1 hour
             */
            maxAge?: number | DurationLike;
            /**
             * Overrides max-age for shared caches (e.g., CDNs).
             * Can be specified as a number (seconds) or as a DurationLike object.
             */
            sMaxAge?: number | DurationLike;
            /**
             * Indicates that once a resource becomes stale, caches must not use it without successful validation.
             */
            mustRevalidate?: boolean;
            /**
             * Similar to must-revalidate, but only for shared caches.
             */
            proxyRevalidate?: boolean;
            /**
             * Indicates that the response can be stored but must be revalidated before each use.
             */
            immutable?: boolean;
          };
    };

interface RouteCacheEntry {
  contentType?: string;
  body: any;
  status?: number;
  lastModified: string;
  hash: string;
}
