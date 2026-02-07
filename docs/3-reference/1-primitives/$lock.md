# $lock

## Import

```typescript
import { $lock } from "alepha/lock";
```

## Overview

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

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `handler` | `TFunc` | Yes | The function to execute when the lock is successfully acquired |
| `wait` | `boolean` | No | Whether the lock should wait for other instances to complete before giving up |
| `name` | `string \| ((...args: Parameters&lt;TFunc&gt;) =&gt; string)` | No | The unique identifier for the lock |
| `maxDuration` | `DurationLike` | No | Maximum duration the lock can be held before it expires automatically |

## Examples

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

