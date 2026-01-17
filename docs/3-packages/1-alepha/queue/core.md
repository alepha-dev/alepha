# Alepha - Queue

## Installation

Part of the `alepha` package. Import from `alepha/queue`.

```bash
npm install alepha
```

## Overview

Provides asynchronous message queuing and processing capabilities through declarative queue descriptors.

The queue module enables reliable background job processing and message passing using the `$queue` descriptor
on class properties. It supports schema validation, automatic retries, and multiple queue backends for
building scalable, decoupled applications with robust error handling.

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $consumer()

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

#### $queue()

Creates a queue primitive for asynchronous message processing with background workers.

The $queue primitive enables powerful asynchronous communication patterns in your application.
It provides type-safe message queuing with automatic worker processing, making it perfect for
decoupling components and handling background tasks efficiently.

**Background Processing**
- Automatic worker threads for non-blocking message processing
- Built-in retry mechanisms and error handling
- Dead letter queues for failed message handling
- Graceful shutdown and worker lifecycle management

**Type Safety**
- Full TypeScript support with schema validation using TypeBox
- Type-safe message payloads with automatic inference
- Runtime validation of all queued messages
- Compile-time errors for invalid message structures

**Storage Flexibility**
- Memory provider for development and testing
- Redis provider for production scalability and persistence
- Custom provider support for specialized backends
- Automatic failover and connection pooling

**Performance & Scalability**
- Batch processing support for high-throughput scenarios
- Horizontal scaling with distributed queue backends
- Configurable concurrency and worker pools
- Efficient serialization and message routing

**Reliability**
- Message persistence across application restarts
- Automatic retry with exponential backoff
- Dead letter handling for permanently failed messages
- Comprehensive logging and monitoring integration

```typescript
const emailQueue = $queue({
  name: "email-notifications",
  schema: t.object({
    to: t.text(),
    subject: t.text(),
    body: t.text(),
    priority: t.optional(t.enum(["high", "normal"]))
  }),
  handler: async (message) => {
    await emailService.send(message.payload);
    console.log(`Email sent to ${message.payload.to}`);
  }
});

// Push messages for background processing
await emailQueue.push({
  to: "user@example.com",
  subject: "Welcome!",
  body: "Welcome to our platform",
  priority: "high"
});
```

```typescript
const imageQueue = $queue({
  name: "image-processing",
  provider: RedisQueueProvider,
  schema: t.object({
    imageId: t.text(),
    operations: t.array(t.enum(["resize", "compress", "thumbnail"]))
  }),
  handler: async (message) => {
    for (const op of message.payload.operations) {
      await processImage(message.payload.imageId, op);
    }
  }
});

// Batch processing multiple images
await imageQueue.push(
  { imageId: "img1", operations: ["resize", "thumbnail"] },
  { imageId: "img2", operations: ["compress"] },
  { imageId: "img3", operations: ["resize", "compress", "thumbnail"] }
);
```

```typescript
const taskQueue = $queue({
  name: "dev-tasks",
  provider: "memory",
  schema: t.object({
    taskType: t.enum(["cleanup", "backup", "report"]),
    data: t.record(t.text(), t.any())
  }),
  handler: async (message) => {
    switch (message.payload.taskType) {
      case "cleanup":
        await performCleanup(message.payload.data);
        break;
      case "backup":
        await createBackup(message.payload.data);
        break;
      case "report":
        await generateReport(message.payload.data);
        break;
    }
  }
});
```

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `QUEUE_WORKER_CONCURRENCY` | integer | 1 |  |
| `QUEUE_WORKER_INTERVAL` | integer | 1000 |  |
| `QUEUE_WORKER_MAX_INTERVAL` | integer | 32000 |  |
