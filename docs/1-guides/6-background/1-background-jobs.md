# Background Jobs

Doing everything inside the HTTP request cycle is a recipe for a slow app. Sending emails, generating PDFs, or crunching data should happen in the background.

Alepha provides two primitives for this, depending on *when* you want the code to run.

## 1. `$scheduler`: "Do this later" (Cron)

Use this for recurring tasks.

```typescript
import { $scheduler } from "alepha/scheduler";

class CleanupService {
  // Runs every night at midnight
  purgeOldFiles = $scheduler({
    cron: "0 0 * * *",
    // Optional: distributed lock ensures only ONE instance runs this,
    // even if you have 10 servers running.
    lock: true,
    handler: async () => {
      // ... logic
    }
  });
}
```

## 2. `$queue`: "Do this in the background" (Worker)

Use this when you want to offload work from a user request to a background worker. It handles retries, persistence, and concurrency.

```typescript
import { $queue } from "alepha/queue";

class EmailService {
  // Define the queue and the handler together
  sendEmail = $queue({
    name: "send-email",
    schema: t.object({ to: t.email(), subject: t.text() }),
    handler: async ({ payload }) => {
      await smtp.send(payload);
    }
  });

  // Call it from your API
  async trigger(to: string) {
    await this.sendEmail.push({ to, subject: "Hi!" });
  }
}
```

By default, this uses an **In-Memory** provider (great for dev).
In production, you just switch the provider to **Redis**, and your queues become persistent and scalable across multiple servers without changing your business logic code.

## 3. `$batch`: "Group these together"

Sometimes you don't want to process items one by one. You want to batch them up—maybe to reduce database writes or API calls.

```typescript
import { $batch } from "alepha/batch";

class AnalyticsService {
  // batch up to 100 events, or flush every 5 seconds
  trackEvent = $batch({
    maxSize: 100,
    maxDuration: [5, "seconds"],
    handler: async (events) => {
      // events is an array of all batched items
      await this.db.events.insertMany(events);
    },
  });

  async track(event: AnalyticsEvent) {
    // doesn't execute immediately
    await this.trackEvent.push(event);
  }
}
```

The handler receives an array of all items that were batched together. You write one `insertMany` instead of 100 individual inserts.

### Partitioned Batches

Need to batch items separately based on some key? Use `partitionBy`:

```typescript
class NotificationService {
  // batch notifications per user
  sendNotifications = $batch({
    maxSize: 10,
    maxDuration: [30, "seconds"],
    partitionBy: (notification) => notification.userId,
    handler: async (notifications) => {
      // all notifications in this batch belong to the same user
      const userId = notifications[0].userId;
      await this.pushBulk(userId, notifications);
    },
  });
}
```

Each user gets their own batch. User A's notifications don't mix with User B's.

### Manual Control

```typescript
// wait for the batch containing your item to complete
await this.trackEvent.wait(eventId);

// check batch status
const status = this.trackEvent.status(eventId);
// { batched: true, flushed: false }

// force immediate flush (useful in tests or shutdown)
await this.trackEvent.flush();
```

## 4. `$job`: "Scheduler with receipts"

`$scheduler` is fire-and-forget. You don't know if it ran, when it ran, or if it failed.

`$job` is a scheduler that keeps a paper trail. Every execution is stored in the database with its status and logs.

```typescript
import { $job } from "alepha/api/jobs";

class ReportService {
  generateDailyReport = $job({
    cron: "0 6 * * *", // 6 AM daily
    lock: true,
    handler: async ({ now, log }) => {
      log.info("Starting daily report generation");

      const data = await this.fetchData(now);
      log.info("Fetched data", { rowCount: data.length });

      await this.generatePdf(data);
      log.info("Report generated");
    },
  });
}
```

### What Gets Stored

Every execution creates a record:

```typescript
{
  id: "job_abc123",
  name: "generateDailyReport",
  status: "COMPLETED", // or "STARTED", "FAILED"
  startedAt: "2024-01-15T06:00:00Z",
  completedAt: "2024-01-15T06:00:45Z",
  logs: [
    { level: "info", message: "Starting daily report generation", timestamp: "..." },
    { level: "info", message: "Fetched data", data: { rowCount: 1523 }, timestamp: "..." },
    { level: "info", message: "Report generated", timestamp: "..." }
  ]
}
```

### When Jobs Fail

If your handler throws, the job is marked as `FAILED` and the error is captured:

```typescript
{
  status: "FAILED",
  error: {
    message: "Database connection timeout",
    stack: "..."
  }
}
```

### Querying Job History

```typescript
import { JobProvider } from "alepha/api/jobs";

class AdminService {
  jobs = $inject(JobProvider);

  async getRecentFailures() {
    return await this.jobs.findMany({
      status: "FAILED",
      since: new Date(Date.now() - 24 * 60 * 60 * 1000), // last 24h
    });
  }
}
```

### When to Use `$job` vs `$scheduler`

| Scenario | Use |
|----------|-----|
| Simple cleanup task | `$scheduler` |
| Need to know if it ran | `$job` |
| Debugging production issues | `$job` |
| Compliance/audit requirements | `$job` |
| Temporary one-off task | `$scheduler` |

The overhead of `$job` is minimal—one database write per execution. If you're running a job that takes 30 seconds, the 5ms database write is noise.

## Summary

| Primitive | Use Case |
|-----------|----------|
| `$scheduler` | Recurring cron tasks, fire-and-forget |
| `$queue` | Background work from user requests, with retries |
| `$batch` | Group multiple items before processing |
| `$job` | Scheduled tasks with execution history and logs |

Pick the right tool:
- **"Run this every night"** → `$scheduler`
- **"Process this in the background"** → `$queue`
- **"Batch these up"** → `$batch`
- **"Run this every night and tell me what happened"** → `$job`
