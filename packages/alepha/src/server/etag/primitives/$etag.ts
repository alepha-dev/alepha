import { createMiddleware, type Middleware } from "alepha";
import type { CachePrimitiveOptions } from "alepha/cache";
import type { DurationLike } from "alepha/datetime";
import { ServerEtagProvider } from "../providers/ServerEtagProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Middleware that enables ETag-based response caching per-route.
 *
 * Sets per-request etag options in the ALS context.
 * The global `ServerEtagProvider` hooks read these
 * to generate ETags, handle 304s, and optionally store responses.
 *
 * When `store` is enabled, the middleware also checks the cache before
 * calling the handler, short-circuiting on cache hits.
 *
 * **Route middleware** - works inside `$action`, `$page`, or any pipeline.
 *
 * ```typescript
 * class UserController {
 *   // ETag only (no response caching)
 *   getUser = $action({
 *     use: [$etag()],
 *     handler: async ({ params }) => { ... },
 *   });
 *
 *   // ETag + response caching (store)
 *   getProfile = $action({
 *     use: [$etag(true)],
 *     handler: async ({ params }) => { ... },
 *   });
 *
 *   // Fine-grained control
 *   getStats = $action({
 *     use: [$etag({ store: { ttl: [5, "minutes"] }, control: { public: true, maxAge: 300 } })],
 *     handler: async ({ params }) => { ... },
 *   });
 * }
 * ```
 *
 * Stored responses are namespaced by caller identity (the `authorization` and
 * `cookie` headers), so an authenticated route does not serve one user's body
 * to another. Anonymous callers share a single entry.
 */
export const $etag = (options?: EtagMiddlewareOptions): Middleware => {
  const resolved = resolveEtagOptions(options);

  return createMiddleware({
    name: "$etag",
    options: resolved as unknown as Record<string, unknown>,
    handler: ({ alepha, next }) => {
      const etagProvider = alepha.inject(ServerEtagProvider);

      return async (...args) => {
        const request = alepha.get("alepha.http.request") ?? args[0];

        // Set etag options on request metadata for hooks to read
        if (request?.metadata) {
          request.metadata.etagOptions = resolved;
        }

        // If store is enabled, check cache before handler
        if (etagProvider.shouldStore(resolved)) {
          if (request) {
            const cached = await etagProvider.checkCache(request, resolved);

            // checkCache sets request.metadata.etagHit on cache hit
            // cached may be undefined for 304 responses (no body)
            if (cached !== undefined || request.metadata?.etagHit) {
              return cached;
            }
          }
        }

        return next(...args);
      };
    },
  });
};

// ---------------------------------------------------------------------------------------------------------------------

export function resolveEtagOptions(
  options?: EtagMiddlewareOptions,
): EtagMiddlewareOptionsResolved {
  if (options === true) {
    return { store: true, etag: true };
  }

  if (!options) {
    return { etag: true };
  }

  return { etag: true, ...options };
}

// ---------------------------------------------------------------------------------------------------------------------

export type EtagMiddlewareOptions =
  /**
   * If true, enables both store and etag.
   */
  | true
  /**
   * Object configuration for fine-grained control.
   */
  | {
      /**
       * If true, enables storing cached responses. (in-memory, Redis, @see alepha/cache for other providers)
       * If a DurationLike is provided, it will be used as the TTL for the cache.
       * If CachePrimitiveOptions is provided, its `ttl` is used as the TTL.
       *
       * With `store: true` the cache's own default TTL applies (300s).
       *
       * @default false
       */
      store?: true | DurationLike | CachePrimitiveOptions;

      /**
       * If true, enables ETag support for the cached responses.
       *
       * @default true (always true when using $etag)
       */
      etag?: true;

      /**
       * - If true, sets Cache-Control to "public, max-age=300" (5 minutes).
       * - If string, sets Cache-Control to the provided value directly.
       * - If object, configures Cache-Control directives.
       */
      control?:
        | true
        | string
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
            /**
             * Time window (in seconds or DurationLike) during which a stale response may be served
             * while a fresh one is fetched in the background.
             * Supported by Cloudflare, modern browsers, and most CDNs.
             */
            staleWhileRevalidate?: number | DurationLike;
          };
    };

export interface EtagMiddlewareOptionsResolved {
  store?: true | DurationLike | CachePrimitiveOptions;
  etag?: true;
  control?:
    | true
    | string
    | {
        public?: boolean;
        private?: boolean;
        noCache?: boolean;
        noStore?: boolean;
        maxAge?: number | DurationLike;
        sMaxAge?: number | DurationLike;
        mustRevalidate?: boolean;
        proxyRevalidate?: boolean;
        immutable?: boolean;
        staleWhileRevalidate?: number | DurationLike;
      };
}
