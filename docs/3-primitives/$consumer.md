# $consumer

> Creates a consumer primitive to process messages from a specific queue.

## Import

```typescript
import { $consumer } from "alepha/queue";
```

## Overview

Creates a consumer primitive to process messages from a specific queue.

Provides a dedicated message consumer that connects to a queue and processes messages
with custom handler logic, enabling scalable architectures where multiple consumers
can process messages from the same queue.

**Key Features**
- Seamless integration with any $queue primitive
- Full type safety inherited from queue schema
- Automatic worker management for background processing
- Built-in error handling and retry mechanisms
- Support for multiple consumers per queue for horizontal scaling

**Common Use Cases**
- Email sending and notification services
- Image and media processing workers
- Data synchronization and background jobs

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `queue` | `QueuePrimitive&lt;T&gt;` | Yes | The queue primitive that this consumer will process messages from |
| `handler` | `Object` | Yes | Message handler function that processes individual messages from the queue |

## Examples

```ts
class EmailService {
  emailQueue = $queue({
    name: "emails",
    schema: t.object({
      to: t.text(),
      subject: t.text(),
      body: t.text()
    })
  });

  emailConsumer = $consumer({
    queue: this.emailQueue,
    handler: async (message) => {
      const { to, subject, body } = message.payload;
      await this.sendEmail(to, subject, body);
    }
  });

  async sendWelcomeEmail(userEmail: string) {
    await this.emailQueue.push({
      to: userEmail,
      subject: "Welcome!",
      body: "Thanks for joining."
    });
  }
}
```

