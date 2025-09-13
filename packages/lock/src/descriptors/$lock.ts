import {
	$env,
	$inject,
	type AsyncFn,
	createDescriptor,
	Descriptor,
	KIND,
	type Static,
	t,
} from "@alepha/core";
import {
	type DateTime,
	DateTimeProvider,
	type DurationLike,
} from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import { $topic, TopicTimeoutError } from "@alepha/topic";
import { LockProvider } from "../providers/LockProvider.ts";
import { LockTopicProvider } from "../providers/LockTopicProvider.ts";

/**
 * Creates a distributed lock descriptor for ensuring single-instance execution across processes.
 *
 * This descriptor provides a powerful distributed locking mechanism that prevents multiple instances
 * of the same operation from running simultaneously. It's essential for maintaining data consistency
 * and preventing race conditions in distributed applications, scheduled tasks, and critical sections
 * that must execute atomically.
 *
 * **Key Features**
 *
 * - **Distributed Coordination**: Works across multiple processes, servers, and containers
 * - **Automatic Expiration**: Locks expire automatically to prevent deadlocks
 * - **Graceful Handling**: Configurable wait behavior for different use cases
 * - **Grace Periods**: Optional lock extension after completion for additional safety
 * - **Topic Integration**: Uses pub/sub for efficient lock release notifications
 * - **Unique Instance IDs**: Prevents lock conflicts between different instances
 * - **Timeout Management**: Configurable durations with intelligent retry logic
 *
 * **Use Cases**
 *
 * Perfect for ensuring single execution in distributed environments:
 * - Database migrations and schema updates
 * - Scheduled job execution (cron-like tasks)
 * - File processing and batch operations
 * - Critical section protection
 * - Resource initialization and cleanup
 * - Singleton service operations
 * - Cache warming and maintenance tasks
 *
 * @example
 * **Basic lock for scheduled tasks:**
 * ```ts
 * import { $lock } from "@alepha/lock";
 *
 * class ScheduledTaskService {
 *   dailyReport = $lock({
 *     handler: async () => {
 *       // This will only run on one server even if multiple servers
 *       // trigger the task simultaneously
 *       console.log('Generating daily report...');
 *
 *       const report = await this.generateDailyReport();
 *       await this.sendReportToManagement(report);
 *
 *       console.log('Daily report completed');
 *     }
 *   });
 *
 *   async runDailyReport() {
 *     // Multiple servers can call this, but only one will execute
 *     await this.dailyReport.run();
 *   }
 * }
 * ```
 *
 * @example
 * **Migration lock with wait behavior:**
 * ```ts
 * class DatabaseService {
 *   migration = $lock({
 *     wait: true,  // Wait for other instances to complete migration
 *     maxDuration: [10, "minutes"],  // Migration timeout
 *     handler: async (version: string) => {
 *       console.log(`Running migration to version ${version}`);
 *
 *       const currentVersion = await this.getCurrentSchemaVersion();
 *       if (currentVersion >= version) {
 *         console.log(`Already at version ${version}, skipping`);
 *         return;
 *       }
 *
 *       await this.runMigrationScripts(version);
 *       await this.updateSchemaVersion(version);
 *
 *       console.log(`Migration to ${version} completed`);
 *     }
 *   });
 *
 *   async migrateToVersion(version: string) {
 *     // All instances will wait for the first one to complete
 *     // before continuing with their startup process
 *     await this.migration.run(version);
 *   }
 * }
 * ```
 *
 * @example
 * **Dynamic lock keys with grace periods:**
 * ```ts
 * class FileProcessor {
 *   processFile = $lock({
 *     name: (filePath: string) => `file-processing:${filePath}`,
 *     wait: false,  // Don't wait, skip if already processing
 *     maxDuration: [30, "minutes"],
 *     gracePeriod: [5, "minutes"],  // Keep lock for 5min after completion
 *     handler: async (filePath: string) => {
 *       console.log(`Processing file: ${filePath}`);
 *
 *       try {
 *         const fileData = await this.readFile(filePath);
 *         const processedData = await this.processData(fileData);
 *         await this.saveProcessedData(filePath, processedData);
 *         await this.moveToCompleted(filePath);
 *
 *         console.log(`File processing completed: ${filePath}`);
 *       } catch (error) {
 *         console.error(`File processing failed: ${filePath}`, error);
 *         await this.moveToError(filePath, error.message);
 *         throw error;
 *       }
 *     }
 *   });
 *
 *   async processUploadedFile(filePath: string) {
 *     // Each file gets its own lock, preventing duplicate processing
 *     // Grace period prevents immediate reprocessing of the same file
 *     await this.processFile.run(filePath);
 *   }
 * }
 * ```
 *
 * @example
 * **Resource initialization with conditional grace periods:**
 * ```ts
 * class CacheService {
 *   warmCache = $lock({
 *     name: (cacheKey: string) => `cache-warming:${cacheKey}`,
 *     wait: true,  // Wait for cache to be warmed before continuing
 *     maxDuration: [15, "minutes"],
 *     gracePeriod: (cacheKey: string) => {
 *       // Dynamic grace period based on cache importance
 *       const criticalCaches = ['user-sessions', 'product-catalog'];
 *       return criticalCaches.includes(cacheKey)
 *         ? [30, "minutes"]  // Longer grace for critical caches
 *         : [5, "minutes"];   // Shorter grace for regular caches
 *     },
 *     handler: async (cacheKey: string, force: boolean = false) => {
 *       console.log(`Warming cache: ${cacheKey}`);
 *
 *       if (!force && await this.isCacheWarm(cacheKey)) {
 *         console.log(`Cache ${cacheKey} is already warm`);
 *         return;
 *       }
 *
 *       const startTime = Date.now();
 *
 *       switch (cacheKey) {
 *         case 'user-sessions':
 *           await this.warmUserSessionsCache();
 *           break;
 *         case 'product-catalog':
 *           await this.warmProductCatalogCache();
 *           break;
 *         case 'configuration':
 *           await this.warmConfigurationCache();
 *           break;
 *         default:
 *           throw new Error(`Unknown cache key: ${cacheKey}`);
 *       }
 *
 *       const duration = Date.now() - startTime;
 *       console.log(`Cache warming completed for ${cacheKey} in ${duration}ms`);
 *
 *       await this.markCacheAsWarm(cacheKey);
 *     }
 *   });
 *
 *   async ensureCacheWarmed(cacheKey: string, force: boolean = false) {
 *     // Multiple instances can call this, but cache warming happens only once
 *     // All instances wait for completion before proceeding
 *     await this.warmCache.run(cacheKey, force);
 *   }
 * }
 * ```
 *
 * @example
 * **Critical section protection with custom timeout handling:**
 * ```ts
 * class InventoryService {
 *   updateInventory = $lock({
 *     name: (productId: string) => `inventory-update:${productId}`,
 *     wait: true,  // Ensure all inventory updates are sequential
 *     maxDuration: [2, "minutes"],
 *     gracePeriod: [30, "seconds"],  // Brief grace to prevent immediate conflicts
 *     handler: async (productId: string, quantity: number, operation: 'add' | 'subtract') => {
 *       console.log(`Updating inventory for product ${productId}: ${operation} ${quantity}`);
 *
 *       try {
 *         // Start transaction for inventory update
 *         await this.db.transaction(async (tx) => {
 *           const currentInventory = await tx.getInventory(productId);
 *
 *           if (operation === 'subtract' && currentInventory.quantity < quantity) {
 *             throw new Error(`Insufficient inventory for product ${productId}. Available: ${currentInventory.quantity}, Requested: ${quantity}`);
 *           }
 *
 *           const newQuantity = operation === 'add'
 *             ? currentInventory.quantity + quantity
 *             : currentInventory.quantity - quantity;
 *
 *           await tx.updateInventory(productId, newQuantity);
 *
 *           // Log inventory change for audit
 *           await tx.logInventoryChange({
 *             productId,
 *             operation,
 *             quantity,
 *             previousQuantity: currentInventory.quantity,
 *             newQuantity,
 *             timestamp: new Date()
 *           });
 *
 *           console.log(`Inventory updated for product ${productId}: ${currentInventory.quantity} -> ${newQuantity}`);
 *         });
 *
 *         // Notify other services about inventory change
 *         await this.inventoryChangeNotifier.notify({
 *           productId,
 *           operation,
 *           quantity,
 *           timestamp: new Date()
 *         });
 *
 *       } catch (error) {
 *         console.error(`Inventory update failed for product ${productId}`, error);
 *         throw error;
 *       }
 *     }
 *   });
 *
 *   async addInventory(productId: string, quantity: number) {
 *     await this.updateInventory.run(productId, quantity, 'add');
 *   }
 *
 *   async subtractInventory(productId: string, quantity: number) {
 *     await this.updateInventory.run(productId, quantity, 'subtract');
 *   }
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
	LOCK_PREFIX_KEY: t.string({ default: "lock" }),
});

declare module "@alepha/core" {
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
				name: t.string(),
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
