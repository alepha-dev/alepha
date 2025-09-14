# Alepha Batch

Efficiently process operations in groups by size or time.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

This module allows you to group multiple asynchronous operations into a single "batch," which is then processed together.
This is an essential pattern for improving performance, reducing I/O, and interacting efficiently with rate-limited APIs or databases.

```ts
import { Alepha, $hook, run, t } from "alepha";
import { $batch } from "alepha/batch";

class LoggingService {
  // define the batch processor
  logBatch = $batch({
    schema: t.string(),
    maxSize: 10,
    maxDuration: [5, "seconds"],
    handler: async (items) => {
      console.log(`[BATCH LOG] Processing ${items.length} events:`, items);
    },
  });

  // example of how to use it
  onReady = $hook({
    on: "ready",
    handler: async () => {
      this.logBatch.push("Application started.");
      this.logBatch.push("User authenticated.");
      // ... more events pushed from elsewhere in the app
    },
  });
}
```

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaBatch } from "alepha/batch";

const alepha = Alepha.create()
	.with(AlephaBatch);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $batch()

Creates a batch processing descriptor for efficient grouping and processing of multiple operations.

This descriptor provides a powerful batching mechanism that collects multiple individual items
and processes them together in groups, significantly improving performance by reducing overhead
and enabling bulk operations. It supports partitioning, concurrent processing, automatic flushing,
and intelligent retry mechanisms for robust batch processing workflows.

**Key Features**

- **Intelligent Batching**: Groups items based on size and time thresholds
- **Partitioning Support**: Process different types of items in separate batches
- **Concurrent Processing**: Handle multiple batches simultaneously with configurable limits
- **Automatic Flushing**: Time-based and size-based automatic batch execution
- **Type Safety**: Full TypeScript support with schema validation using TypeBox
- **Retry Logic**: Built-in retry mechanisms for failed batch operations
- **Resource Management**: Automatic cleanup and graceful shutdown handling

**Use Cases**

Perfect for optimizing high-throughput operations:
- Database bulk inserts and updates
- API call batching and rate limit optimization
- Log aggregation and bulk shipping
- File processing and bulk uploads
- Event processing and analytics ingestion
- Notification delivery optimization
- Cache invalidation batching

**Basic database batch operations:**
```ts
import { $batch } from "alepha/batch";
import { t } from "alepha";

class UserService {
  userBatch = $batch({
    schema: t.object({
      id: t.string(),
      name: t.string(),
      email: t.string(),
      createdAt: t.optional(t.string())
    }),
    maxSize: 50,          // Process up to 50 users at once
    maxDuration: [5, "seconds"],  // Or flush every 5 seconds
    handler: async (users) => {
      // Bulk insert users - much faster than individual inserts
      console.log(`Processing batch of ${users.length} users`);

      const result = await this.database.users.insertMany(users.map(user => ({
        ...user,
        createdAt: user.createdAt || new Date().toISOString()
      })));

      console.log(`Successfully inserted ${result.length} users`);
      return { inserted: result.length, userIds: result.map(r => r.id) };
    }
  });

  async createUser(userData: { name: string; email: string }) {
    // Individual calls are automatically batched
    const result = await this.userBatch.push({
      id: generateId(),
      name: userData.name,
      email: userData.email
    });

    return result; // Returns the batch result once batch is processed
  }
}
```

**API call batching with partitioning:**
```ts
class NotificationService {
  notificationBatch = $batch({
    schema: t.object({
      userId: t.string(),
      type: t.enum(["email", "sms", "push"]),
      message: t.string(),
      priority: t.enum(["high", "normal", "low"])
    }),
    maxSize: 100,
    maxDuration: [10, "seconds"],
    // Partition by notification type for different processing
    partitionBy: (notification) => notification.type,
    concurrency: 3,  // Process up to 3 different types simultaneously
    handler: async (notifications) => {
      const type = notifications[0].type; // All items in batch have same type
      console.log(`Processing ${notifications.length} ${type} notifications`);

      switch (type) {
        case 'email':
          return await this.emailProvider.sendBulk(notifications.map(n => ({
            to: n.userId,
            subject: 'Notification',
            body: n.message,
            priority: n.priority
          })));

        case 'sms':
          return await this.smsProvider.sendBulk(notifications.map(n => ({
            to: n.userId,
            message: n.message
          })));

        case 'push':
          return await this.pushProvider.sendBulk(notifications.map(n => ({
            userId: n.userId,
            title: 'Notification',
            body: n.message,
            priority: n.priority
          })));
      }
    }
  });

  async sendNotification(userId: string, type: 'email' | 'sms' | 'push', message: string, priority: 'high' | 'normal' | 'low' = 'normal') {
    // Notifications are automatically batched by type
    return await this.notificationBatch.push({
      userId,
      type,
      message,
      priority
    });
  }
}
```

**Log aggregation with retry logic:**
```ts
class LoggingService {
  logBatch = $batch({
    schema: t.object({
      timestamp: t.number(),
      level: t.enum(["info", "warn", "error"]),
      message: t.string(),
      metadata: t.optional(t.record(t.string(), t.any())),
      source: t.string()
    }),
    maxSize: 1000,       // Large batches for log efficiency
    maxDuration: [30, "seconds"],  // Longer duration for log aggregation
    concurrency: 2,      // Limit concurrent log shipments
    retry: {
      maxAttempts: 5,
      delay: [2, "seconds"],
      backoff: "exponential"
    },
    handler: async (logEntries) => {
      console.log(`Shipping ${logEntries.length} log entries`);

      try {
        // Ship logs to external service (e.g., Elasticsearch, Splunk)
        const response = await this.logShipper.bulkIndex({
          index: 'application-logs',
          body: logEntries.map(entry => ([
            { index: { _index: 'application-logs' } },
            {
              ...entry,
              '@timestamp': new Date(entry.timestamp).toISOString()
            }
          ])).flat()
        });

        if (response.errors) {
          console.error(`Some log entries failed to index`, response.errors);
          // Retry will be triggered by throwing
          throw new Error(`Failed to index ${response.errors.length} log entries`);
        }

        console.log(`Successfully shipped ${logEntries.length} log entries`);
        return { shipped: logEntries.length, indexedAt: Date.now() };

      } catch (error) {
        console.error(`Failed to ship logs batch`, error);
        throw error; // Trigger retry mechanism
      }
    }
  });

  async log(level: 'info' | 'warn' | 'error', message: string, metadata?: Record<string, any>, source: string = 'application') {
    // Individual log calls are batched and shipped efficiently
    return await this.logBatch.push({
      timestamp: Date.now(),
      level,
      message,
      metadata,
      source
    });
  }
}
```

**File processing with dynamic partitioning:**
```ts
class FileProcessingService {
  fileProcessingBatch = $batch({
    schema: t.object({
      filePath: t.string(),
      fileType: t.enum(["image", "video", "document"]),
      processingOptions: t.object({
        quality: t.optional(t.enum(["low", "medium", "high"])),
        format: t.optional(t.string()),
        compress: t.optional(t.boolean())
      }),
      priority: t.enum(["urgent", "normal", "background"])
    }),
    maxSize: 20,         // Smaller batches for file processing
    maxDuration: [2, "minutes"],  // Reasonable time for file accumulation
    // Partition by file type and priority for optimal resource usage
    partitionBy: (file) => `${file.fileType}-${file.priority}`,
    concurrency: 4,      // Multiple concurrent processing pipelines
    retry: {
      maxAttempts: 3,
      delay: [5, "seconds"]
    },
    handler: async (files) => {
      const fileType = files[0].fileType;
      const priority = files[0].priority;

      console.log(`Processing ${files.length} ${fileType} files with ${priority} priority`);

      try {
        const results = [];

        for (const file of files) {
          const result = await this.processFile(file.filePath, file.fileType, file.processingOptions);
          results.push({
            originalPath: file.filePath,
            processedPath: result.outputPath,
            size: result.size,
            duration: result.processingTime
          });
        }

        // Update database with batch results
        await this.updateProcessingStatus(results);

        console.log(`Successfully processed ${files.length} ${fileType} files`);
        return {
          processed: files.length,
          fileType,
          priority,
          totalSize: results.reduce((sum, r) => sum + r.size, 0),
          results
        };

      } catch (error) {
        console.error(`Batch file processing failed for ${fileType} files`, error);
        throw error;
      }
    }
  });

  async processFile(filePath: string, fileType: 'image' | 'video' | 'document', options: any, priority: 'urgent' | 'normal' | 'background' = 'normal') {
    // Files are automatically batched by type and priority
    return await this.fileProcessingBatch.push({
      filePath,
      fileType,
      processingOptions: options,
      priority
    });
  }
}
```
