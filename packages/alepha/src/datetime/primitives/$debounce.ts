import { createMiddleware, type Middleware } from "alepha";
import {
  DateTimeProvider,
  type DurationLike,
} from "../providers/DateTimeProvider.ts";

export interface DebounceOptions {
  /**
   * Coalescing window. Concurrent calls within this window share one execution.
   */
  delay: DurationLike;

  /**
   * Key function to group calls. Calls with the same key are coalesced.
   * Defaults to `JSON.stringify(args)`.
   */
  key?: (...args: any[]) => string;
}

/**
 * Middleware that coalesces concurrent calls with the same key into a single handler execution.
 *
 * All callers within the delay window receive the same result. No storage —
 * once the handler finishes, the next call starts fresh. Process-local.
 *
 * **Use case**: thundering herd protection — cache expires, 100 requests
 * hit the same endpoint, debounce ensures one rebuild.
 *
 * ```typescript
 * class SearchController {
 *   search = $action({
 *     use: [$debounce({ delay: [200, "ms"], key: (req) => req.query.q })],
 *     handler: async ({ query }) => this.searchService.search(query.q),
 *   });
 * }
 * ```
 */
export const $debounce = (options: DebounceOptions): Middleware => {
  return createMiddleware({
    name: "$debounce",
    options: options as unknown as Record<string, unknown>,
    handler: ({ alepha, next }) => {
      const dateTimeProvider = alepha.inject(DateTimeProvider);
      const pending = new Map<string, Promise<any>>();

      return async (...args) => {
        const key = options.key?.(...args) ?? JSON.stringify(args);

        const existing = pending.get(key);
        if (existing) {
          return existing;
        }

        let resolve: (value: any) => void;
        let reject: (error: any) => void;
        const promise = new Promise<any>((res, rej) => {
          resolve = res;
          reject = rej;
        });

        dateTimeProvider.createTimeout(async () => {
          try {
            const result = await next(...args);
            resolve!(result);
          } catch (error) {
            reject!(error);
          } finally {
            pending.delete(key);
          }
        }, options.delay);

        pending.set(key, promise);
        return promise;
      };
    },
  });
};
