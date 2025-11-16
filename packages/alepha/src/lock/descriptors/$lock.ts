import {
  $env,
  $inject,
  type AsyncFn,
  createDescriptor,
  Descriptor,
  KIND,
  type Static,
  t,
} from "alepha";
import {
  type DateTime,
  DateTimeProvider,
  type DurationLike,
} from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $topic, TopicTimeoutError } from "alepha/topic";
import { LockProvider } from "../providers/LockProvider.ts";
import { LockTopicProvider } from "../providers/LockTopicProvider.ts";

/**
 * Creates a distributed lock descriptor for ensuring single-instance execution across processes.
 *
 * Prevents multiple instances of the same operation from running simultaneously, essential for
 * maintaining data consistency and preventing race conditions in distributed applications.
 *
 * **Key Features**
 * - Distributed coordination across multiple processes, servers, and containers
 * - Automatic expiration to prevent deadlocks
 * - Configurable wait behavior (blocking vs. non-blocking)
 * - Optional grace periods for lock extension after completion
 * - Dynamic or static lock keys for fine-grained control
 *
 * **Common Use Cases**
 * - Database migrations and scheduled jobs
 * - File processing and batch operations
 * - Critical section protection and resource initialization
 *
 * @example
 * ```ts
 * class TaskService {
 *   // Basic scheduled task - only one server executes
 *   dailyReport = $lock({
 *     handler: async () => {
 *       const report = await this.generateDailyReport();
 *       await this.sendReportToManagement(report);
 *     }
 *   });
 *
 *   // Migration with wait - all instances wait for completion
 *   migration = $lock({
 *     wait: true,
 *     maxDuration: [10, "minutes"],
 *     handler: async (version: string) => {
 *       await this.runMigrationScripts(version);
 *     }
 *   });
 *
 *   // Dynamic lock keys for per-resource locking
 *   processFile = $lock({
 *     name: (fileId: string) => `file-processing:${fileId}`,
 *     gracePeriod: [5, "minutes"],
 *     handler: async (fileId: string) => {
 *       await this.processFileData(fileId);
 *     }
 *   });
 * }
 * ```
 */
export const $lock = <TFunc extends AsyncFn>(
  options: LockDescriptorOptions<TFunc>,
): LockDescriptor<TFunc> => {
  return createDescriptor(LockDescriptor<TFunc>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface LockDescriptorOptions<TFunc extends AsyncFn> {
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
   * scheduledCleanup = $lock({
   *   wait: false,  // Skip if cleanup already running
   *   handler: async () => { } // perform cleanup
   * });
   *
   * // Migration - wait for completion before proceeding
   * migration = $lock({
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
   * globalCleanup = $lock({
   *   name: "system-cleanup",
   *   handler: async () => { } // perform cleanup
   * });
   *
   * // Dynamic lock key - per-user locks, users don't block each other
   * updateUserProfile = $lock({
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
   * quickTask = $lock({
   *   maxDuration: [2, "minutes"],  // Quick timeout for fast operations
   *   handler: async () => { } // perform quick task
   * });
   *
   * heavyProcessing = $lock({
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
   * fileProcessor = $lock({
   *   gracePeriod: [10, "minutes"],  // Prevent reprocessing same file immediately
   *   handler: async (filePath: string) => {
   *     await this.processFile(filePath);
   *   }
   * });
   *
   * userOperation = $lock({
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

const envSchema = t.object({
  LOCK_PREFIX_KEY: t.text({ default: "lock" }),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

export class LockDescriptor<TFunc extends AsyncFn> extends Descriptor<
  LockDescriptorOptions<TFunc>
> {
  protected readonly log = $logger();
  protected readonly provider = $inject(LockProvider);
  protected readonly env = $env(envSchema);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly id = crypto.randomUUID();
  public readonly maxDuration = this.dateTimeProvider.duration(
    this.options.maxDuration ?? [5, "minutes"],
  );

  protected readonly topicLockEnd = $topic({
    name: `${this.env.LOCK_PREFIX_KEY}:lock-end`,
    provider: LockTopicProvider,
    schema: {
      payload: t.object({
        name: t.text(),
      }),
    },
  });

  public async run(...args: Parameters<TFunc>): Promise<void> {
    const key = this.key(...args);
    const handler = this.options.handler;

    const lock = await this.lock(key);
    if (lock.endedAt) {
      return;
    }

    if (lock.id !== this.id) {
      if (this.options.wait) {
        try {
          await this.wait(key, this.maxDuration);
        } catch (error) {
          if (error instanceof TopicTimeoutError) {
            this.log.warn(
              `Lock timeout for '${key}' has been reached. Retry...`,
            );
            await this.run(...args);
          } else {
            throw error;
          }
        }
      }

      return;
    }

    this.log.debug(`Lock '${key}' ...`);

    try {
      await handler(...args);
    } finally {
      await this.topicLockEnd.publish({
        name: key,
      });

      await this.setGracePeriod(key, lock, ...args);

      this.log.debug(`Lock '${key}' OK`);
    }
  }

  /**
   * Set the lock for the given key.
   */
  protected async lock(key: string): Promise<LockResult> {
    const value = await this.provider.set(
      key,
      `${this.id},${this.dateTimeProvider.nowISOString()}`,
      true,
      this.maxDuration.as("milliseconds"),
    );

    return this.parse(value);
  }

  protected async setGracePeriod(
    key: string,
    lock: LockResult,
    ...args: Parameters<TFunc>
  ): Promise<void> {
    const gracePeriod = this.options.gracePeriod
      ? this.dateTimeProvider.isDurationLike(this.options.gracePeriod)
        ? this.options.gracePeriod
        : this.options.gracePeriod(...args)
      : undefined;

    if (gracePeriod) {
      await this.provider.set(
        key,
        `${this.id},${lock.createdAt.toISOString()},${this.dateTimeProvider.nowISOString()}`,
        false,
        this.dateTimeProvider.duration(gracePeriod).as("milliseconds"),
      );
    } else {
      await this.provider.del(key);
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

    return `${this.env.LOCK_PREFIX_KEY}:${base}`;
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

$lock[KIND] = LockDescriptor;

export interface LockResult {
  id: string;
  createdAt: DateTime;
  endedAt?: DateTime;
  response?: string;
}
