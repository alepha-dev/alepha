# Alepha Lock

Distributed mutex and semaphore for resource locking and synchronization.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/lock
```

## Module

Lock a resource for a certain period of time.

This module provides a memory implementation of the lock provider.
You probably want to use an implementation like RedisLockProvider for distributed systems.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaLock } from "alepha/lock";

const alepha = Alepha.create()
	.with(AlephaLock);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

For more details, see the [Descriptors documentation](https://feunard.github.io/alepha/docs/descriptors).

#### $lock()

Creates a distributed lock descriptor for ensuring single-instance execution across processes.

This descriptor provides a powerful distributed locking mechanism that prevents multiple instances
of the same operation from running simultaneously. It's essential for maintaining data consistency
and preventing race conditions in distributed applications, scheduled tasks, and critical sections
that must execute atomically.

**Key Features**

- **Distributed Coordination**: Works across multiple processes, servers, and containers
- **Automatic Expiration**: Locks expire automatically to prevent deadlocks
- **Graceful Handling**: Configurable wait behavior for different use cases
- **Grace Periods**: Optional lock extension after completion for additional safety
- **Topic Integration**: Uses pub/sub for efficient lock release notifications
- **Unique Instance IDs**: Prevents lock conflicts between different instances
- **Timeout Management**: Configurable durations with intelligent retry logic

**Use Cases**

Perfect for ensuring single execution in distributed environments:
- Database migrations and schema updates
- Scheduled job execution (cron-like tasks)
- File processing and batch operations
- Critical section protection
- Resource initialization and cleanup
- Singleton service operations
- Cache warming and maintenance tasks

**Basic lock for scheduled tasks:**
```ts
import { $lock } from "@alepha/lock";

class ScheduledTaskService {
  dailyReport = $lock({
    handler: async () => {
      // This will only run on one server even if multiple servers
      // trigger the task simultaneously
      console.log('Generating daily report...');

      const report = await this.generateDailyReport();
      await this.sendReportToManagement(report);

      console.log('Daily report completed');
    }
  });

  async runDailyReport() {
    // Multiple servers can call this, but only one will execute
    await this.dailyReport.run();
  }
}
```

**Migration lock with wait behavior:**
```ts
class DatabaseService {
  migration = $lock({
    wait: true,  // Wait for other instances to complete migration
    maxDuration: [10, "minutes"],  // Migration timeout
    handler: async (version: string) => {
      console.log(`Running migration to version ${version}`);

      const currentVersion = await this.getCurrentSchemaVersion();
      if (currentVersion >= version) {
        console.log(`Already at version ${version}, skipping`);
        return;
      }

      await this.runMigrationScripts(version);
      await this.updateSchemaVersion(version);

      console.log(`Migration to ${version} completed`);
    }
  });

  async migrateToVersion(version: string) {
    // All instances will wait for the first one to complete
    // before continuing with their startup process
    await this.migration.run(version);
  }
}
```

**Dynamic lock keys with grace periods:**
```ts
class FileProcessor {
  processFile = $lock({
    name: (filePath: string) => `file-processing:${filePath}`,
    wait: false,  // Don't wait, skip if already processing
    maxDuration: [30, "minutes"],
    gracePeriod: [5, "minutes"],  // Keep lock for 5min after completion
    handler: async (filePath: string) => {
      console.log(`Processing file: ${filePath}`);

      try {
        const fileData = await this.readFile(filePath);
        const processedData = await this.processData(fileData);
        await this.saveProcessedData(filePath, processedData);
        await this.moveToCompleted(filePath);

        console.log(`File processing completed: ${filePath}`);
      } catch (error) {
        console.error(`File processing failed: ${filePath}`, error);
        await this.moveToError(filePath, error.message);
        throw error;
      }
    }
  });

  async processUploadedFile(filePath: string) {
    // Each file gets its own lock, preventing duplicate processing
    // Grace period prevents immediate reprocessing of the same file
    await this.processFile.run(filePath);
  }
}
```

**Resource initialization with conditional grace periods:**
```ts
class CacheService {
  warmCache = $lock({
    name: (cacheKey: string) => `cache-warming:${cacheKey}`,
    wait: true,  // Wait for cache to be warmed before continuing
    maxDuration: [15, "minutes"],
    gracePeriod: (cacheKey: string) => {
      // Dynamic grace period based on cache importance
      const criticalCaches = ['user-sessions', 'product-catalog'];
      return criticalCaches.includes(cacheKey)
        ? [30, "minutes"]  // Longer grace for critical caches
        : [5, "minutes"];   // Shorter grace for regular caches
    },
    handler: async (cacheKey: string, force: boolean = false) => {
      console.log(`Warming cache: ${cacheKey}`);

      if (!force && await this.isCacheWarm(cacheKey)) {
        console.log(`Cache ${cacheKey} is already warm`);
        return;
      }

      const startTime = Date.now();

      switch (cacheKey) {
        case 'user-sessions':
          await this.warmUserSessionsCache();
          break;
        case 'product-catalog':
          await this.warmProductCatalogCache();
          break;
        case 'configuration':
          await this.warmConfigurationCache();
          break;
        default:
          throw new Error(`Unknown cache key: ${cacheKey}`);
      }

      const duration = Date.now() - startTime;
      console.log(`Cache warming completed for ${cacheKey} in ${duration}ms`);

      await this.markCacheAsWarm(cacheKey);
    }
  });

  async ensureCacheWarmed(cacheKey: string, force: boolean = false) {
    // Multiple instances can call this, but cache warming happens only once
    // All instances wait for completion before proceeding
    await this.warmCache.run(cacheKey, force);
  }
}
```

**Critical section protection with custom timeout handling:**
```ts
class InventoryService {
  updateInventory = $lock({
    name: (productId: string) => `inventory-update:${productId}`,
    wait: true,  // Ensure all inventory updates are sequential
    maxDuration: [2, "minutes"],
    gracePeriod: [30, "seconds"],  // Brief grace to prevent immediate conflicts
    handler: async (productId: string, quantity: number, operation: 'add' | 'subtract') => {
      console.log(`Updating inventory for product ${productId}: ${operation} ${quantity}`);

      try {
        // Start transaction for inventory update
        await this.db.transaction(async (tx) => {
          const currentInventory = await tx.getInventory(productId);

          if (operation === 'subtract' && currentInventory.quantity < quantity) {
            throw new Error(`Insufficient inventory for product ${productId}. Available: ${currentInventory.quantity}, Requested: ${quantity}`);
          }

          const newQuantity = operation === 'add'
            ? currentInventory.quantity + quantity
            : currentInventory.quantity - quantity;

          await tx.updateInventory(productId, newQuantity);

          // Log inventory change for audit
          await tx.logInventoryChange({
            productId,
            operation,
            quantity,
            previousQuantity: currentInventory.quantity,
            newQuantity,
            timestamp: new Date()
          });

          console.log(`Inventory updated for product ${productId}: ${currentInventory.quantity} -> ${newQuantity}`);
        });

        // Notify other services about inventory change
        await this.inventoryChangeNotifier.notify({
          productId,
          operation,
          quantity,
          timestamp: new Date()
        });

      } catch (error) {
        console.error(`Inventory update failed for product ${productId}`, error);
        throw error;
      }
    }
  });

  async addInventory(productId: string, quantity: number) {
    await this.updateInventory.run(productId, quantity, 'add');
  }

  async subtractInventory(productId: string, quantity: number) {
    await this.updateInventory.run(productId, quantity, 'subtract');
  }
}
```

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

#### MemoryLockProvider

A simple in-memory store provider.
