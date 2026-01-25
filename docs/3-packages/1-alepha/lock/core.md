# Alepha - Lock

## Installation

Part of the `alepha` package. Import from `alepha/lock`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| backend | rare | stable |

Resource locking for distributed systems.

**Features:**
- Distributed locks with timeout
- Time-based lock expiration
- Automatic release on scope exit
- Distributed coordination via Redis
- Providers: Memory (dev), Redis (production)

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $lock()

Creates a distributed lock primitive for ensuring single-instance execution across processes.

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

For more details, see the [Providers documentation](/docs/concepts-providers).

#### MemoryLockProvider

A simple in-memory store provider.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LOCK_PREFIX_KEY` | text | lock |  |
