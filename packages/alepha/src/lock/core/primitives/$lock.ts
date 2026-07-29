import {
  $atom,
  $context,
  $inject,
  $state,
  AlephaError,
  type AsyncFn,
  createMiddleware,
  type Middleware,
  Primitive,
  type Static,
  z,
} from "alepha";
import {
  type DateTime,
  DateTimeProvider,
  type DurationLike,
} from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $topic } from "alepha/topic";
import { LockAcquireError } from "../errors/LockAcquireError.ts";
import { LockProvider } from "../providers/LockProvider.ts";
import { LockTopicProvider } from "../providers/LockTopicProvider.ts";

/**
 * Distributed lock middleware for `use` arrays in `$action`, `$job`, `$page`, `$pipeline`.
 *
 * Acquires a distributed lock before the handler runs and releases it after completion.
 * Throws `LockAcquireError` if the lock cannot be acquired — with `wait: true`
 * it polls first, but still throws when the wait times out.
 *
 * ```ts
 * processOrder = $action({
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

        const [lockId, _createdAtStr, endedAtStr] = value.split(",");

        // Lock already ended (grace period active)
        if (endedAtStr) {
          await alepha.events.emit("lock:contended", { name, id });
          throw new LockAcquireError(name);
        }

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
              throw new LockAcquireError(name);
            }
          } else {
            throw new LockAcquireError(name);
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

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Options for the class-based `LockPrimitive`, constructed via
 * `createPrimitive(LockPrimitive, { ... })`. Note this is a different surface
 * from the exported `$lock(...)` **middleware** above, which takes
 * {@link LockMiddlewareOptions} and has no `handler`.
 */
export interface LockPrimitiveOptions<TFunc extends AsyncFn> {
  /**
   * The function to execute when the lock is successfully acquired.
   *
   * This function:
   * - Only executes on the instance that successfully acquires the lock
   * - Has exclusive access to the protected resource during execution
   * - Should contain the critical section logic that must not run concurrently
   * - Can be async and perform any operations needed
   * - Will automatically release the lock upon completion or error
   * - Has access to the full Alepha dependency injection container
   *
   * **Handler Design Guidelines**:
   * - Keep critical sections as short as possible to minimize lock contention
   * - Include proper error handling to ensure locks are released
   * - Use timeouts for external operations to prevent deadlocks
   * - Log important operations for debugging and monitoring
   * - Consider idempotency for handlers that might be retried
   *
   * @param ...args - The arguments passed to the lock execution
   * @returns Promise that resolves when the protected operation is complete
   *
   * @example
   * ```ts
   * handler: async (batchId: string) => {
   *   console.log(`Processing batch ${batchId} - only one instance will run this`);
   *
   *   const batch = await this.getBatchData(batchId);
   *   const results = await this.processBatchItems(batch.items);
   *   await this.saveBatchResults(batchId, results);
   *
   *   console.log(`Batch ${batchId} completed successfully`);
   * }
   * ```
   */
  handler: TFunc;

  /**
   * Whether the lock should wait for other instances to complete before giving up.
   *
   * **wait = false (default)**:
   * - Non-blocking behavior - if lock is held, immediately return without executing
   * - Perfect for scheduled tasks where you only want one execution per trigger
   * - Use when multiple triggers are acceptable but concurrent execution is not
   * - Examples: periodic cleanup, cron jobs, background maintenance
   *
   * **wait = true**:
   * - Blocking behavior - wait for the current lock holder to finish
   * - All instances will eventually execute (one after another)
   * - Perfect for initialization tasks where all instances need the work completed
   * - Examples: database migrations, cache warming, resource initialization
   *
   * **Trade-offs**:
   * - Non-waiting: Better performance, may miss executions if timing is off
   * - Waiting: Guaranteed execution order, slower overall throughput
   *
   * @default false
   *
   * @example
   * ```ts
   * // Scheduled task - don't wait, just skip if already running
   * scheduledCleanup = createPrimitive(LockPrimitive, {
   *   wait: false,  // Skip if cleanup already running
   *   handler: async () => { } // perform cleanup
   * });
   *
   * // Migration - wait for completion before proceeding
   * migration = createPrimitive(LockPrimitive, {
   *   wait: true,   // All instances wait for migration to complete
   *   handler: async () => { } // perform migration
   * });
   * ```
   */
  wait?: boolean;

  /**
   * The unique identifier for the lock.
   *
   * Can be either:
   * - **Static string**: A fixed identifier for the lock
   * - **Dynamic function**: A function that generates the lock key based on arguments
   *
   * **Dynamic Lock Keys**:
   * - Enable per-resource locking (e.g., per-user, per-file, per-product)
   * - Allow fine-grained concurrency control
   * - Prevent unnecessary blocking between unrelated operations
   *
   * **Key Design Guidelines**:
   * - Use descriptive names that indicate the protected resource
   * - Include relevant identifiers for dynamic keys
   * - Keep keys reasonably short but unique
   * - Consider using hierarchical naming (e.g., "service:operation:resource")
   *
   * If not provided, defaults to `{serviceName}:{propertyKey}`.
   *
   * @example "user-migration"
   * @example "daily-report-generation"
   * @example (userId: string) => `user-profile-update:${userId}`
   * @example (fileId: string, operation: string) => `file-${operation}:${fileId}`
   *
   * @example
   * ```ts
   * // Static lock key - all instances compete for the same lock
   * globalCleanup = createPrimitive(LockPrimitive, {
   *   name: "system-cleanup",
   *   handler: async () => { } // perform cleanup
   * });
   *
   * // Dynamic lock key - per-user locks, users don't block each other
   * updateUserProfile = createPrimitive(LockPrimitive, {
   *   name: (userId: string) => `user-update:${userId}`,
   *   handler: async (userId: string, data: UserData) => {
   *     // Only one update per user at a time, but different users can update concurrently
   *   }
   * });
   * ```
   */
  name?: string | ((...args: Parameters<TFunc>) => string);

  /**
   * Maximum duration the lock can be held before it expires automatically.
   *
   * This prevents deadlocks when a process dies while holding a lock or when
   * operations take longer than expected. The lock will be automatically released
   * after this duration, allowing other instances to proceed.
   *
   * **Duration Guidelines**:
   * - Set based on expected operation duration plus safety margin
   * - Too short: Operations may be interrupted by early expiration
   * - Too long: Failed processes block others for extended periods
   * - Consider worst-case scenarios and external dependency timeouts
   *
   * **Typical Values**:
   * - Quick operations: 30 seconds - 2 minutes
   * - Database operations: 5 - 15 minutes
   * - File processing: 10 - 30 minutes
   * - Large migrations: 30 minutes - 2 hours
   *
   * @default [5, "minutes"]
   *
   * @example [30, "seconds"]    // Quick operations
   * @example [10, "minutes"]    // Database migrations
   * @example [1, "hour"]        // Long-running batch jobs
   *
   * @example
   * ```ts
   * quickTask = createPrimitive(LockPrimitive, {
   *   maxDuration: [2, "minutes"],  // Quick timeout for fast operations
   *   handler: async () => { } // perform quick task
   * });
   *
   * heavyProcessing = createPrimitive(LockPrimitive, {
   *   maxDuration: [30, "minutes"], // Longer timeout for heavy work
   *   handler: async () => { } // perform heavy processing
   * });
   * ```
   */
  maxDuration?: DurationLike;

  /**
   * Additional time to keep the lock active after the handler completes successfully.
   *
   * This provides a "cooling off" period that can be useful for:
   * - Preventing immediate re-execution of the same operation
   * - Giving time for related systems to process the results
   * - Avoiding race conditions with dependent operations
   * - Providing a buffer for cleanup operations
   *
   * Can be either:
   * - **Static duration**: Fixed grace period for all executions
   * - **Dynamic function**: Grace period determined by execution arguments
   * - **undefined**: No grace period, lock released immediately after completion
   *
   * **Grace Period Use Cases**:
   * - File processing: Prevent immediate reprocessing of uploaded files
   * - Cache updates: Allow time for cache propagation
   * - Batch operations: Prevent overlapping batch processing
   * - External API calls: Respect rate limiting requirements
   *
   * @default undefined (no grace period)
   *
   * @example [5, "minutes"]     // Fixed 5-minute grace period
   * @example [30, "seconds"]    // Short grace for quick operations
   * @example (userId: string) => userId.startsWith("premium") ? [10, "minutes"] : [2, "minutes"]
   *
   * @example
   * ```ts
   * fileProcessor = createPrimitive(LockPrimitive, {
   *   gracePeriod: [10, "minutes"],  // Prevent reprocessing same file immediately
   *   handler: async (filePath: string) => {
   *     await this.processFile(filePath);
   *   }
   * });
   *
   * userOperation = createPrimitive(LockPrimitive, {
   *   gracePeriod: (userId: string, operation: string) => {
   *     // Dynamic grace based on operation type
   *     return operation === 'migration' ? [30, "minutes"] : [5, "minutes"];
   *   },
   *   handler: async (userId: string, operation: string) => {
   *     await this.performUserOperation(userId, operation);
   *   }
   * });
   * ```
   */
  gracePeriod?:
    | ((...args: Parameters<TFunc>) => DurationLike | undefined)
    | DurationLike;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Lock configuration atom.
 */
export const lockOptions = $atom({
  name: "alepha.lock.options",
  schema: z.object({
    prefixKey: z.text({
      default: "",
      description: "Prefix for all lock keys.",
    }),
  }),
  default: {
    prefixKey: "",
  },
  serverOnly: true,
});

export type LockAtomOptions = Static<typeof lockOptions.schema>;

declare module "alepha" {
  interface State {
    [lockOptions.key]: LockAtomOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class LockPrimitive<TFunc extends AsyncFn> extends Primitive<
  LockPrimitiveOptions<TFunc>
> {
  protected readonly log = $logger();
  protected readonly provider = $inject(LockProvider);
  protected readonly settings = $state(lockOptions);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);

  public readonly maxDuration = this.dateTimeProvider.duration(
    this.options.maxDuration ?? [5, "minutes"],
  );

  protected readonly topicLockEnd = $topic({
    name: `${this.settings.prefixKey}lock:end`,
    provider: LockTopicProvider,
    schema: {
      payload: z.object({
        name: z.text(),
      }),
    },
  });

  public async run(...args: Parameters<TFunc>): Promise<void> {
    const key = this.key(...args);
    const handler = this.options.handler;

    // Per-invocation identity: a single id shared by the primitive instance
    // would hand every overlapping run() call the same identity — all of
    // them would read back "their own" id from SET NX GET and enter the
    // critical section together.
    const id = crypto.randomUUID();

    const lock = await this.lock(key, id);
    if (lock.endedAt) {
      return;
    }

    if (lock.id !== id) {
      if (!this.options.wait) {
        return;
      }

      // Poll until the lock is released; each poll is itself an NX acquire
      // attempt with OUR id, so winning the poll means holding the lock —
      // fall through to the critical section (re-running from the top would
      // mint a fresh id and mistake our own lock for another holder's).
      const start = this.dateTimeProvider.nowMillis();
      const maxMs = this.maxDuration.as("milliseconds");
      let acquired = false;
      while (this.dateTimeProvider.nowMillis() - start < maxMs) {
        await this.dateTimeProvider.wait(500);
        const current = await this.lock(key, id);
        if (current.endedAt) {
          // A previous holder finished with a grace period — skip entirely.
          return;
        }
        if (current.id === id || !current.id) {
          acquired = true;
          break;
        }
      }
      if (!acquired) {
        this.log.warn(`Lock wait timeout for '${key}', giving up`);
        return;
      }
    }

    this.log.debug(`Lock '${key}' ...`);

    try {
      await handler(...args);
    } finally {
      await this.topicLockEnd.publish({
        name: key,
      });

      await this.setGracePeriod(key, lock, id, ...args);

      this.log.debug(`Lock '${key}' OK`);
    }
  }

  /**
   * Set the lock for the given key.
   */
  protected async lock(key: string, id: string): Promise<LockResult> {
    const value = await this.provider.set(
      key,
      `${id},${this.dateTimeProvider.nowISOString()}`,
      true,
      this.maxDuration.as("milliseconds"),
    );

    return this.parse(value);
  }

  protected async setGracePeriod(
    key: string,
    lock: LockResult,
    id: string,
    ...args: Parameters<TFunc>
  ): Promise<void> {
    const gracePeriod = this.options.gracePeriod
      ? this.dateTimeProvider.isDurationLike(this.options.gracePeriod)
        ? this.options.gracePeriod
        : this.options.gracePeriod(...args)
      : undefined;

    if (gracePeriod) {
      // Only extend a lock we still own — if ours expired mid-handler,
      // overwriting would clobber the next holder's lock.
      const current = await this.provider.get(key);
      const owner = current?.split(",")[0];
      if (owner !== undefined && owner !== id) {
        return;
      }
      await this.provider.set(
        key,
        `${id},${lock.createdAt.toISOString()},${this.dateTimeProvider.nowISOString()}`,
        false,
        this.dateTimeProvider.duration(gracePeriod).as("milliseconds"),
      );
    } else {
      await this.provider.delIfOwner(key, id);
    }
  }

  protected async wait(key: string, maxDuration: DurationLike): Promise<void> {
    this.log.debug(`Wait for lock '${key}' ...`);

    await this.topicLockEnd.wait({
      filter: (message) => message.payload.name === key,
      timeout: maxDuration,
    });

    this.log.debug(`Wait for lock '${key}' OK`);
  }

  protected key(...args: Parameters<TFunc>) {
    let base = "";

    if (this.options.name) {
      if (typeof this.options.name === "string") {
        base = this.options.name;
      } else {
        base = this.options.name(...args);
      }
    } else {
      base = `${this.config.service.name}:${this.config.propertyKey}`;
    }

    return `${this.settings.prefixKey}${base}`;
  }

  protected parse(value: string): LockResult {
    const [id, createdAtStr, endedAtStr] = value.split(",");
    const createdAt = this.dateTimeProvider.of(createdAtStr);
    const endedAt = endedAtStr
      ? this.dateTimeProvider.of(endedAtStr)
      : undefined;

    return {
      id,
      createdAt,
      endedAt,
    };
  }
}

export interface LockResult {
  id: string;
  createdAt: DateTime;
  endedAt?: DateTime;
  response?: string;
}
