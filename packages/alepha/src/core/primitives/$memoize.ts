import { createMiddleware, type Middleware } from "./$pipeline.ts";

/**
 * Lightweight in-process memoization middleware.
 *
 * Caches handler results in a plain `Map` — no external store, no serialization,
 * no provider dependency. Process-local only. Entries live until eviction by capacity.
 *
 * ```typescript
 * class Api {
 *   getStats = $action({
 *     use: [$memoize({ max: 100 })],
 *     handler: async () => this.repo.aggregate(),
 *   });
 * }
 * ```
 *
 * > For more advanced caching, use `$cache` from "alepha/cache" instead — it supports TTL, invalidation, external stores (Redis).
 */
export const $memoize = (options?: MemoizeOptions): Middleware => {
  return createMiddleware({
    name: "$memoize",
    options: options as unknown as Record<string, unknown>,
    handler: ({ next }) => {
      const store = new Map<string, any>();
      const maxSize = options?.max ?? 1000;
      const keyFn = options?.key ?? ((...args: any[]) => JSON.stringify(args));

      return async (...args) => {
        const key = keyFn(...args);
        if (store.has(key)) {
          return store.get(key);
        }

        // Store the promise immediately to deduplicate concurrent calls
        // for the same key (thundering herd prevention).
        const promise = next(...args);
        store.set(key, promise);

        try {
          const result = await promise;

          // Replace the promise with the resolved value
          store.set(key, result);

          // Evict oldest if at capacity
          if (store.size > maxSize) {
            const firstKey = store.keys().next().value;
            if (firstKey !== undefined) {
              store.delete(firstKey);
            }
          }

          return result;
        } catch (error) {
          // Don't cache failed results
          store.delete(key);
          throw error;
        }
      };
    },
  });
};

export interface MemoizeOptions {
  /**
   * Maximum number of entries to keep in the cache.
   * When exceeded, the oldest entry is evicted (FIFO).
   *
   * @default 1000
   */
  max?: number;

  /**
   * Custom key function. Receives the handler's arguments.
   * By default, `JSON.stringify(args)` is used.
   */
  key?: (...args: any[]) => string;
}
