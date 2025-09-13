# Alepha Queue

A simple, powerful interface for message queueing systems.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/queue
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

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

For more details, see the [Descriptors documentation](https://feunard.github.io/alepha/docs/descriptors).

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
import { $queue, $consumer } from "@alepha/queue";
import { t } from "@alepha/core";

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
      type: t.union([t.literal("email"), t.literal("sms"), t.literal("push")]),
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

This descriptor provides a powerful message queue system that enables decoupled, asynchronous
communication between different parts of your application. It supports multiple storage backends,
type-safe message handling, and automatic worker processing with intelligent retry mechanisms.

**Key Features**

- **Type-Safe Messages**: Full TypeScript support with schema validation using TypeBox
- **Multiple Storage Backends**: Support for in-memory, Redis, and custom queue providers
- **Background Processing**: Automatic worker threads for message processing
- **Reliable Delivery**: Built-in retry mechanisms and error handling
- **Scalable Architecture**: Horizontal scaling support with distributed queue backends
- **Dead Letter Queues**: Failed message handling with configurable retry policies

**Use Cases**

Perfect for decoupling application components and handling asynchronous tasks:
- Background job processing
- Email and notification sending
- Image/file processing pipelines
- Event-driven architectures
- Microservice communication
- Long-running data operations

**Basic queue with automatic processing:**
```ts
import { $queue } from "@alepha/queue";
import { t } from "@alepha/core";

class NotificationService {
  emailQueue = $queue({
    name: "email-notifications",
    schema: t.object({
      to: t.string(),
      subject: t.string(),
      body: t.string(),
      priority: t.optional(t.union([t.literal("high"), t.literal("normal")]))
    }),
    handler: async (message) => {
      // This runs in a background worker
      await this.sendEmail(message.payload);
      console.log(`Email sent to ${message.payload.to}`);
    }
  });

  async sendWelcomeEmail(userEmail: string) {
    // Push message to queue for background processing
    await this.emailQueue.push({
      to: userEmail,
      subject: "Welcome to our platform!",
      body: "Thank you for joining us...",
      priority: "high"
    });
  }
}
```

**Batch processing with multiple messages:**
```ts
class ImageProcessor {
  imageQueue = $queue({
    name: "image-processing",
    description: "Process uploaded images for optimization and thumbnails",
    schema: t.object({
      imageId: t.string(),
      originalUrl: t.string(),
      userId: t.string(),
      operations: t.array(t.union([
        t.literal("resize"),
        t.literal("compress"),
        t.literal("thumbnail")
      ]))
    }),
    handler: async (message) => {
      const { imageId, originalUrl, operations } = message.payload;

      for (const operation of operations) {
        await this.processImage(imageId, originalUrl, operation);
      }

      console.log(`Processed image ${imageId} with operations: ${operations.join(", ")}`);
    }
  });

  async processUploadedImages(images: Array<{id: string; url: string; userId: string}>) {
    // Process multiple images in parallel
    const messages = images.map(img => ({
      imageId: img.id,
      originalUrl: img.url,
      userId: img.userId,
      operations: ["resize", "compress", "thumbnail"] as const
    }));

    // Push all messages at once for efficient batch processing
    await this.imageQueue.push(...messages);
  }
}
```

**Redis-backed queue for production scalability:**
```ts
class OrderProcessor {
  orderQueue = $queue({
    name: "order-processing",
    provider: RedisQueueProvider,  // Use Redis for distributed processing
    schema: t.object({
      orderId: t.string(),
      customerId: t.string(),
      items: t.array(t.object({
        productId: t.string(),
        quantity: t.number(),
        price: t.number()
      })),
      paymentMethod: t.string(),
      shippingAddress: t.object({
        street: t.string(),
        city: t.string(),
        zipCode: t.string(),
        country: t.string()
      })
    }),
    handler: async (message) => {
      const { orderId, customerId, items } = message.payload;

      // Process payment
      await this.processPayment(orderId, items);

      // Update inventory
      await this.updateInventory(items);

      // Send confirmation email
      await this.sendOrderConfirmation(customerId, orderId);

      // Schedule shipping
      await this.scheduleShipping(orderId, message.payload.shippingAddress);

      console.log(`Order ${orderId} processed successfully`);
    }
  });
}
```

**Memory-only queue for development and testing:**
```ts
class DevTaskProcessor {
  taskQueue = $queue({
    name: "dev-tasks",
    provider: "memory",  // Use in-memory queue for development
    schema: t.object({
      taskType: t.union([t.literal("cleanup"), t.literal("backup"), t.literal("report")]),
      data: t.record(t.string(), t.any()),
      scheduledAt: t.optional(t.string())
    }),
    handler: async (message) => {
      const { taskType, data } = message.payload;

      switch (taskType) {
        case "cleanup":
          await this.performCleanup(data);
          break;
        case "backup":
          await this.createBackup(data);
          break;
        case "report":
          await this.generateReport(data);
          break;
      }
    }
  });
}
```
