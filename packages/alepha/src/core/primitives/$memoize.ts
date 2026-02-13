import { createMiddleware, type Middleware } from "alepha";

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

        const result = await next(...args);

        // Evict oldest if at capacity
        if (store.size >= maxSize) {
          const firstKey = store.keys().next().value;
          if (firstKey !== undefined) {
            store.delete(firstKey);
          }
        }

        store.set(key, result);

        return result;
      };
    },
  });
};
