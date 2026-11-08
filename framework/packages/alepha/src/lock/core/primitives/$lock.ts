import {
  $context,
  AlephaError,
  createMiddleware,
  type Middleware,
} from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { Tracer } from "alepha/tracing";

import { LockAcquireError } from "../errors/LockAcquireError.ts";
import { LockProvider } from "../providers/LockProvider.ts";
import { MemoryLockProvider } from "../providers/MemoryLockProvider.ts";

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
  const crypto = alepha.inject(CryptoProvider);
  const tracer = alepha.inject(Tracer);
  const log = $logger();
  // On Cloudflare Workers no Redis client runs, so the lock is the memory
  // one and holds only inside one isolate. Said once per `$lock`, on its
  // first call, rather than at boot: a lock that never runs costs nothing.
  let warnedPerIsolate = false;

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

        if (
          !warnedPerIsolate &&
          lockProvider instanceof MemoryLockProvider &&
          alepha.isServerless()
        ) {
          warnedPerIsolate = true;
          log.warn(
            `$lock '${name}' is in memory on a serverless runtime, so it excludes only callers in this isolate. For mutual exclusion across isolates use an $actor (it runs in a Durable Object, one call at a time), or a conditional write the database refuses twice.`,
          );
        }

        // The acquire, as one span (#E86): `lock acquire`, ended once the
        // lock is held or `LockAcquireError` is thrown. The held section
        // belongs to the handler's own span. `lock.name` only when the name
        // is static: a computed one can hold an id.
        let contended = false;
        const acquire = async () => {
          const value = await lockProvider.set(
            name,
            `${id},${dateTimeProvider.nowISOString()}`,
            true,
            maxDurationMs,
          );

          const [lockId] = value.split(",");

          // Lock held by someone else
          if (lockId !== id) {
            contended = true;
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
        };

        if (tracer.recording) {
          const waitStart = dateTimeProvider.nowMillis();
          await tracer.startSpan(
            "lock acquire",
            { requireParent: true },
            async (span) => {
              if (typeof options.name === "string") {
                span.setAttribute("lock.name", options.name);
              }
              try {
                await acquire();
              } finally {
                span.setAttribute("lock.contended", contended);
                span.setAttribute(
                  "lock.wait_ms",
                  dateTimeProvider.nowMillis() - waitStart,
                );
              }
            },
          );
        } else {
          await acquire();
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
