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
