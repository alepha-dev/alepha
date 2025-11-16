# Alepha - Lock

## Installation

```bash
npm install alepha
```

## Overview

Lock a resource for a certain period of time.

This module provides a memory implementation of the lock provider.
You probably want to use an implementation like RedisLockProvider for distributed systems.

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $lock()

Creates a distributed lock descriptor for ensuring single-instance execution across processes.

Prevents multiple instances of the same operation from running simultaneously, essential for
maintaining data consistency and preventing race conditions in distributed applications.

**Key Features**
- Distributed coordination across multiple processes, servers, and containers
- Automatic expiration to prevent deadlocks
- Configurable wait behavior (blocking vs. non-blocking)
- Optional grace periods for lock extension after completion
- Dynamic or static lock keys for fine-grained control

**Common Use Cases**
- Database migrations and scheduled jobs
- File processing and batch operations
- Critical section protection and resource initialization

```ts
class TaskService {
  // Basic scheduled task - only one server executes
  dailyReport = $lock({
    handler: async () => {
      const report = await this.generateDailyReport();
      await this.sendReportToManagement(report);
    }
  });

  // Migration with wait - all instances wait for completion
  migration = $lock({
    wait: true,
    maxDuration: [10, "minutes"],
    handler: async (version: string) => {
      await this.runMigrationScripts(version);
    }
  });

  // Dynamic lock keys for per-resource locking
  processFile = $lock({
    name: (fileId: string) => `file-processing:${fileId}`,
    gracePeriod: [5, "minutes"],
    handler: async (fileId: string) => {
      await this.processFileData(fileId);
    }
  });
}
```

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/providers).

#### MemoryLockProvider

A simple in-memory store provider.
