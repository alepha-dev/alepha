# Alepha Queue

A simple, powerful interface for message queueing systems.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides asynchronous message queuing and processing capabilities through declarative queue descriptors.

The queue module enables reliable background job processing and message passing using the `$queue` descriptor
on class properties. It supports schema validation, automatic retries, and multiple queue backends for
building scalable, decoupled applications with robust error handling.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaQueue } from "alepha/queue";

const alepha = Alepha.create()
	.with(AlephaQueue);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $consumer()

Creates a consumer descriptor to process messages from a specific queue.

This descriptor creates a dedicated message consumer that connects to a queue and processes
its messages using a custom handler function. Consumers provide a clean way to separate
message production from consumption, enabling scalable architectures where multiple
consumers can process messages from the same queue.

**Key Features**

- **Queue Integration**: Seamlessly connects to any $queue descriptor
- **Type Safety**: Full TypeScript support inherited from the connected queue's schema
- **Dedicated Processing**: Isolated message processing logic separate from the queue
- **Worker Management**: Automatic integration with the worker system for background processing
- **Error Handling**: Built-in error handling and retry mechanisms from the queue system
- **Scalability**: Multiple consumers can process the same queue for horizontal scaling

**Use Cases**

Perfect for creating specialized message processors:
- Dedicated email sending services
- Image processing workers
- Data synchronization tasks
- Event handlers for specific domains
- Microservice message consumers
- Background job processors

**Basic consumer setup:**
```ts
import { $queue, $consumer } from "alepha/queue";
import { t } from "alepha";

class EmailService {
  // Define the queue
  emailQueue = $queue({
    name: "emails",
    schema: t.object({
      to: t.string(),
      subject: t.string(),
      body: t.string(),
      template: t.optional(t.string())
    })
  });

  // Create a dedicated consumer for this queue
  emailConsumer = $consumer({
    queue: this.emailQueue,
    handler: async (message) => {
      const { to, subject, body, template } = message.payload;

      if (template) {
        await this.sendTemplatedEmail(to, template, { subject, body });
      } else {
        await this.sendPlainEmail(to, subject, body);
      }

      console.log(`Email sent to ${to}: ${subject}`);
    }
  });

  async sendWelcomeEmail(userEmail: string) {
    // Push to queue - consumer will automatically process it
    await this.emailQueue.push({
      to: userEmail,
      subject: "Welcome!",
      body: "Thanks for joining our platform.",
      template: "welcome"
    });
  }
}
```

**Multiple specialized consumers for different message types:**
```ts
class NotificationService {
  notificationQueue = $queue({
    name: "notifications",
    schema: t.object({
      type: t.enum(["email", "sms", "push"]),
      recipient: t.string(),
      message: t.string(),
      metadata: t.optional(t.record(t.string(), t.any()))
    })
  });

  // Email-specific consumer
  emailConsumer = $consumer({
    queue: this.notificationQueue,
    handler: async (message) => {
      if (message.payload.type === "email") {
        await this.emailProvider.send({
          to: message.payload.recipient,
          subject: message.payload.metadata?.subject || "Notification",
          body: message.payload.message
        });
      }
    }
  });

  // SMS-specific consumer
  smsConsumer = $consumer({
    queue: this.notificationQueue,
    handler: async (message) => {
      if (message.payload.type === "sms") {
        await this.smsProvider.send({
          to: message.payload.recipient,
          message: message.payload.message
        });
      }
    }
  });

  // Push notification consumer
  pushConsumer = $consumer({
    queue: this.notificationQueue,
    handler: async (message) => {
      if (message.payload.type === "push") {
        await this.pushProvider.send({
          deviceToken: message.payload.recipient,
          title: message.payload.metadata?.title || "Notification",
          body: message.payload.message
        });
      }
    }
  });
}
```

**Consumer with advanced error handling and logging:**
```ts
class OrderProcessor {
  orderQueue = $queue({
    name: "order-processing",
    schema: t.object({
      orderId: t.string(),
      customerId: t.string(),
      items: t.array(t.object({
        productId: t.string(),
        quantity: t.number(),
        price: t.number()
      }))
    })
  });

  orderConsumer = $consumer({
    queue: this.orderQueue,
    handler: async (message) => {
      const { orderId, customerId, items } = message.payload;

      try {
        // Log processing start
        this.logger.info(`Processing order ${orderId} for customer ${customerId}`);

        // Validate inventory
        await this.validateInventory(items);

        // Process payment
        const paymentResult = await this.processPayment(orderId, items);
        if (!paymentResult.success) {
          throw new Error(`Payment failed: ${paymentResult.error}`);
        }

        // Update inventory
        await this.updateInventory(items);

        // Create shipment
        await this.createShipment(orderId, customerId);

        // Send confirmation
        await this.sendOrderConfirmation(customerId, orderId);

        this.logger.info(`Order ${orderId} processed successfully`);

      } catch (error) {
        // Log detailed error information
        this.logger.error(`Failed to process order ${orderId}`, {
          error: error.message,
          orderId,
          customerId,
          itemCount: items.length
        });

        // Re-throw to trigger queue retry mechanism
        throw error;
      }
    }
  });
}
```

**Consumer for batch processing with performance optimization:**
```ts
class DataProcessor {
  dataQueue = $queue({
    name: "data-processing",
    schema: t.object({
      batchId: t.string(),
      records: t.array(t.object({
        id: t.string(),
        data: t.record(t.string(), t.any())
      })),
      processingOptions: t.object({
        validateData: t.boolean(),
        generateReport: t.boolean(),
        notifyCompletion: t.boolean()
      })
    })
  });

  dataConsumer = $consumer({
    queue: this.dataQueue,
    handler: async (message) => {
      const { batchId, records, processingOptions } = message.payload;
      const startTime = Date.now();

      this.logger.info(`Starting batch processing for ${batchId} with ${records.length} records`);

      try {
        // Process records in chunks for better performance
        const chunkSize = 100;
        const chunks = this.chunkArray(records, chunkSize);

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];

          if (processingOptions.validateData) {
            await this.validateChunk(chunk);
          }

          await this.processChunk(chunk);

          // Log progress
          const progress = ((i + 1) / chunks.length) * 100;
          this.logger.debug(`Batch ${batchId} progress: ${progress.toFixed(1)}%`);
        }

        if (processingOptions.generateReport) {
          await this.generateProcessingReport(batchId, records.length);
        }

        if (processingOptions.notifyCompletion) {
          await this.notifyBatchCompletion(batchId);
        }

        const duration = Date.now() - startTime;
        this.logger.info(`Batch ${batchId} completed in ${duration}ms`);

      } catch (error) {
        const duration = Date.now() - startTime;
        this.logger.error(`Batch ${batchId} failed after ${duration}ms`, error);
        throw error;
      }
    }
  });
}
```

#### $queue()

Creates a queue descriptor for asynchronous message processing with background workers.

The $queue descriptor enables powerful asynchronous communication patterns in your application.
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
    to: t.string(),
    subject: t.string(),
    body: t.string(),
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
    imageId: t.string(),
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
    data: t.record(t.string(), t.any())
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
