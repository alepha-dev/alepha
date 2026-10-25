import {
  $context,
  AlephaError,
  createMiddleware,
  type Middleware,
} from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";

import { LockAcquireError } from "../errors/LockAcquireError.ts";
import { LockProvider } from "../providers/LockProvider.ts";

/**
 * Distributed lock middleware for `use` arrays in `$action`, `$job`, `$page`, `$pipeline`.
 *
 * Acquires a distributed lock before the handler runs and releases it after completion.
 * Throws `LockAcquireError` if the lock cannot be acquired - with `wait: true`
 * it polls first, but still throws when the wait times out.
 *
 * ```ts
 * processOrder = $action({
 *   method: "POST",
 *   path: "/processOrder",
 *   use: [$lock({ name: "process-order" })],
 *   handler: async ({ body }) => { ... },
 * });
 * ```
 */
export const $lock = (options: LockMiddlewareOptions): Middleware => {
  const { alepha } = $context();
  const lockProvider = alepha.inject(LockProvider);
  const dateTimeProvider = alepha.inject(DateTimeProvider);

  return createMiddleware({
    name: "$lock",
    options: options as unknown as Record<string, unknown>,
    handler: ({ alepha, next }) => {
      const maxDurationMs = dateTimeProvider
        .duration(options.maxDuration ?? [5, "minutes"])
        .asMilliseconds();

      return async (...args: any[]) => {
        // Per-invocation identity. The pipeline composes this middleware once
        // and memoizes the wrapped function, so an id created in the handler
        // body (outside this closure) would be shared by every concurrent
        // invocation — `SET NX GET` would then hand each caller back that same
        // shared id, and every one would read `lockId === id` and enter the
        // critical section together. Generating it here, per call, is what makes
        // mutual exclusion actually hold within a single process.
        const id = crypto.randomUUID();
        const name =
          typeof options.name === "function"
            ? options.name(...args)
            : options.name;
        if (!name) {
          throw new AlephaError(
            "$lock middleware requires a name option (no class context available)",
          );
        }

        const value = await lockProvider.set(
          name,
          `${id},${dateTimeProvider.nowISOString()}`,
          true,
          maxDurationMs,
        );

        const [lockId] = value.split(",");

        // Lock held by someone else
        if (lockId !== id) {
          await alepha.events.emit("lock:contended", { name, id });
          if (options.wait) {
            // Poll until lock is released
            const start = dateTimeProvider.nowMillis();
            while (dateTimeProvider.nowMillis() - start < maxDurationMs) {
              await dateTimeProvider.wait(500);
              const current = await lockProvider.set(
                name,
                `${id},${dateTimeProvider.nowISOString()}`,
                true,
                maxDurationMs,
              );
              const [currentId] = current.split(",");
              if (currentId === id) {
                break;
              }
            }
            // Check if we got the lock
            const final = await lockProvider.set(
              name,
              `${id},${dateTimeProvider.nowISOString()}`,
              true,
              maxDurationMs,
            );
            const [finalId] = final.split(",");
            if (finalId !== id) {
              throw new LockAcquireError({ lock: name });
            }
          } else {
            throw new LockAcquireError({ lock: name });
          }
        }

        // We hold the lock — execute handler
        const acquiredAt = dateTimeProvider.nowMillis();
        await alepha.events.emit("lock:acquired", {
          name,
          id,
          maxDurationMs,
        });
        try {
          return await next(...args);
        } finally {
          // Compare-and-delete: if the handler outlived maxDuration the key
          // expired and another instance may hold the lock now — deleting
          // unconditionally would release the NEW holder's lock.
          await lockProvider.delIfOwner(name, id);
          await alepha.events.emit("lock:released", {
            name,
            id,
            heldMs: dateTimeProvider.nowMillis() - acquiredAt,
          });
        }
      };
    },
  });
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Options for $lock in middleware mode (no handler).
 */
export interface LockMiddlewareOptions {
  /**
   * Lock key name. Required in middleware mode (no class context available).
   * Can be a static string or a function that derives the key from handler args.
   */
  name: string | ((...args: any[]) => string);

  /**
   * Whether to wait for the lock to become available.
   *
   * @default false
   */
  wait?: boolean;

  /**
   * Maximum duration the lock can be held before automatic expiration.
   *
   * @default [5, "minutes"]
   */
  maxDuration?: DurationLike;
}
