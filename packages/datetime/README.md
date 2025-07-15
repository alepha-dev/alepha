# Alepha Datetime

Date, time, and duration utilities based on Day.js.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/datetime
```
## Module

Provides timing and scheduling capabilities with declarative interval management and duration utilities.

The datetime module enables time-based operations using the `$interval` descriptor on class properties.
It offers precise timing control, automatic interval lifecycle management, and duration parsing utilities
for building applications that require scheduled tasks, periodic operations, and time-based triggers.

**Key Features:**
- Declarative interval definition with `$interval` descriptor
- Automatic interval lifecycle management (start/stop with context)
- Flexible duration parsing (supports "1s", "5m", "1h", etc.)
- High-precision timing with configurable intervals
- Timeout utilities for one-time delayed operations
- Integration with Alepha lifecycle for resource cleanup

**Basic Usage:**
```ts
import { Alepha, run } from "alepha";
import { AlephaDateTime, $interval } from "alepha/datetime";

class ScheduledTasks {
  // Run every 5 seconds
  healthCheck = $interval({
    duration: "5s",
    handler: async () => {
      console.log("Health check running...");
      await checkSystemHealth();
    },
  });

  // Run every minute, start immediately
  metricsCollection = $interval({
    duration: "1m",
    run: true,
    handler: async () => {
      await collectAndSendMetrics();
    },
  });

  // Manual interval management
  backgroundSync = $interval({
    duration: "30s",
    attach: false, // Don't auto-start
    handler: async () => {
      await syncDataWithRemote();
    },
  });

  async startBackgroundSync() {
    this.backgroundSync.start();
  }

  async stopBackgroundSync() {
    this.backgroundSync.stop();
  }
}

const alepha = Alepha.create()
  .with(AlephaDateTime)
  .with(ScheduledTasks);

run(alepha);
```

**Advanced Interval Patterns:**
```ts
class DataProcessing {
  // Batch processing with variable intervals
  batchProcessor = $interval({
    duration: "10s",
    handler: async () => {
      const pending = await getPendingJobs();
      if (pending.length > 0) {
        await processBatch(pending);
        console.log(`Processed ${pending.length} jobs`);
      }
    },
  });

  // Monitoring with error handling
  systemMonitor = $interval({
    duration: "30s",
    handler: async () => {
      try {
        const stats = await getSystemStats();
        if (stats.cpu > 80) {
          await sendAlert("High CPU usage detected");
        }
      } catch (error) {
        console.error("Monitoring failed:", error);
      }
    },
  });

  // Cleanup operations
  cleanup = $interval({
    duration: "1h",
    handler: async () => {
      await cleanupTempFiles();
      await archiveOldLogs();
      await pruneDatabase();
    },
  });
}
```

**Timeout Utilities:**
```ts
import { Timeout } from "alepha/datetime";

class DelayedOperations {
  async performDelayedTask() {
    console.log("Starting task...");
    
    // Wait for 2 seconds
    await Timeout.wait("2s");
    
    console.log("Task completed after delay");
  }

  async performWithTimeout() {
    try {
      // Execute with 10-second timeout
      const result = await Timeout.race(
        longRunningOperation(),
        "10s"
      );
      return result;
    } catch (error) {
      console.error("Operation timed out or failed:", error);
    }
  }
}
```

## API Reference

### Descriptors

#### $interval()

Registers a new interval.
