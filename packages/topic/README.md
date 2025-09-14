# Alepha Topic

A publish-subscribe (pub/sub) messaging interface for eventing.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Generic interface for pub/sub messaging.
Gives you the ability to create topics and subscribers.
This module provides only a memory implementation of the topic provider.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaTopic } from "alepha/topic";

const alepha = Alepha.create()
	.with(AlephaTopic);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $subscriber()

Creates a subscriber descriptor to listen for messages from a specific topic.

This descriptor creates a dedicated message subscriber that connects to a topic and processes
its messages using a custom handler function. Subscribers provide a clean way to separate
message publishing from consumption, enabling scalable pub/sub architectures where multiple
subscribers can react to the same events independently.

## Key Features

- **Topic Integration**: Seamlessly connects to any $topic descriptor
- **Type Safety**: Full TypeScript support inherited from the connected topic's schema
- **Dedicated Processing**: Isolated message processing logic separate from the topic
- **Real-time Processing**: Immediate message delivery when events are published
- **Error Isolation**: Subscriber errors don't affect other subscribers or the topic
- **Scalability**: Multiple subscribers can listen to the same topic independently

## Use Cases

Perfect for creating specialized event handlers:
- Notification services for user events
- Analytics and logging systems
- Data synchronization between services
- Real-time UI updates
- Event-driven workflow triggers
- Audit and compliance logging

**Basic subscriber setup:**
```ts
import { $topic, $subscriber } from "alepha/topic";
import { t } from "alepha";

class UserActivityService {
  // Define the topic
  userEvents = $topic({
    name: "user-activity",
    schema: {
      payload: t.object({
        userId: t.string(),
        action: t.enum(["login", "logout", "purchase"]),
        timestamp: t.number(),
        metadata: t.optional(t.record(t.string(), t.any()))
      })
    }
  });

  // Create a dedicated subscriber for this topic
  activityLogger = $subscriber({
    topic: this.userEvents,
    handler: async (message) => {
      const { userId, action, timestamp } = message.payload;

      await this.auditLogger.log({
        event: 'user_activity',
        userId,
        action,
        timestamp,
        source: 'user-activity-topic'
      });

      this.log.info(`User ${userId} performed ${action} at ${new Date(timestamp).toISOString()}`);
    }
  });

  async trackUserLogin(userId: string, metadata: Record<string, any>) {
    // Publish to topic - subscriber will automatically process it
    await this.userEvents.publish({
      userId,
      action: "login",
      timestamp: Date.now(),
      metadata
    });
  }
}
```

**Multiple specialized subscribers for different concerns:**
```ts
class OrderEventHandlers {
  orderEvents = $topic({
    name: "order-events",
    schema: {
      payload: t.object({
        orderId: t.string(),
        customerId: t.string(),
        status: t.union([
          t.literal("created"),
          t.literal("paid"),
          t.literal("shipped"),
          t.literal("delivered")
        ]),
        data: t.optional(t.record(t.string(), t.any()))
      })
    }
  });

  // Analytics subscriber
  analyticsSubscriber = $subscriber({
    topic: this.orderEvents,
    handler: async (message) => {
      await this.analytics.track('order_status_changed', {
        orderId: message.payload.orderId,
        customerId: message.payload.customerId,
        status: message.payload.status,
        timestamp: Date.now()
      });
    }
  });

  // Email notification subscriber
  emailSubscriber = $subscriber({
    topic: this.orderEvents,
    handler: async (message) => {
      const { customerId, orderId, status } = message.payload;

      const templates = {
        'paid': 'order-confirmation',
        'shipped': 'order-shipped',
        'delivered': 'order-delivered'
      };

      const template = templates[status];
      if (template) {
        await this.emailService.send({
          customerId,
          template,
          data: { orderId, status }
        });
      }
    }
  });

  // Inventory management subscriber
  inventorySubscriber = $subscriber({
    topic: this.orderEvents,
    handler: async (message) => {
      if (message.payload.status === 'paid') {
        await this.inventoryService.reserveItems(message.payload.orderId);
      } else if (message.payload.status === 'delivered') {
        await this.inventoryService.confirmDelivery(message.payload.orderId);
      }
    }
  });
}
```

**Subscriber with advanced error handling and filtering:**
```ts
class NotificationSubscriber {
  systemEvents = $topic({
    name: "system-events",
    schema: {
      payload: t.object({
        eventType: t.string(),
        severity: t.enum(["info", "warning", "error"]),
        serviceId: t.string(),
        message: t.string(),
        data: t.optional(t.record(t.string(), t.any()))
      })
    }
  });

  alertSubscriber = $subscriber({
    topic: this.systemEvents,
    handler: async (message) => {
      const { eventType, severity, serviceId, message: eventMessage, data } = message.payload;

      try {
        // Only process error events for alerting
        if (severity !== 'error') {
          return;
        }

        // Log the event
        this.logger.error(`System alert from ${serviceId}`, {
          eventType,
          message: eventMessage,
          data
        });

        // Send alerts based on service criticality
        const criticalServices = ['payment', 'auth', 'database'];
        const isCritical = criticalServices.includes(serviceId);

        if (isCritical) {
          // Immediate alert for critical services
          await this.alertService.sendImmediate({
            title: `Critical Error in ${serviceId}`,
            message: eventMessage,
            severity: 'critical',
            metadata: { eventType, serviceId, data }
          });
        } else {
          // Queue non-critical alerts for batching
          await this.alertService.queueAlert({
            title: `Error in ${serviceId}`,
            message: eventMessage,
            severity: 'error',
            metadata: { eventType, serviceId, data }
          });
        }

        // Update service health status
        await this.healthMonitor.recordError(serviceId, eventType);

      } catch (error) {
        // Log subscriber errors but don't re-throw
        // This prevents one failing subscriber from affecting others
        this.log.error(`Alert subscriber failed`, {
          originalEvent: { eventType, serviceId, severity },
          subscriberError: error.message
        });
      }
    }
  });
}
```

**Subscriber for real-time data aggregation:**
```ts
class MetricsAggregator {
  userActivityTopic = $topic({
    name: "user-metrics",
    schema: {
      payload: t.object({
        userId: t.string(),
        sessionId: t.string(),
        eventType: t.string(),
        timestamp: t.number(),
        duration: t.optional(t.number()),
        metadata: t.optional(t.record(t.string(), t.any()))
      })
    }
  });

  metricsSubscriber = $subscriber({
    topic: this.userActivityTopic,
    handler: async (message) => {
      const { userId, sessionId, eventType, timestamp, duration, metadata } = message.payload;

      // Update real-time metrics
      await Promise.all([
        // Update user activity counters
        this.metricsStore.increment(`user:${userId}:events:${eventType}`, 1),
        this.metricsStore.increment(`global:events:${eventType}`, 1),

        // Track session activity
        this.sessionStore.updateActivity(sessionId, timestamp),

        // Record duration metrics if provided
        duration ? this.metricsStore.recordDuration(`events:${eventType}:duration`, duration) : Promise.resolve(),

        // Update time-based aggregations
        this.timeSeriesStore.addPoint({
          metric: `user_activity.${eventType}`,
          timestamp,
          value: 1,
          tags: { userId, sessionId }
        })
      ]);

      // Trigger real-time dashboard updates
      await this.dashboardService.updateRealTimeStats({
        eventType,
        userId,
        timestamp
      });

      this.logger.debug(`Processed metrics for ${eventType}`, {
        userId,
        eventType,
        timestamp
      });
    }
  });
}
```

#### $topic()

Creates a topic descriptor for pub/sub messaging and event-driven architecture.

This descriptor provides a powerful publish/subscribe system that enables decoupled communication
between different parts of your application. Topics allow multiple publishers to send messages
and multiple subscribers to receive them, creating flexible event-driven architectures with
support for real-time messaging and asynchronous event processing.

**Key Features**

- **Publish/Subscribe Pattern**: Decoupled communication between publishers and subscribers
- **Multiple Subscribers**: One-to-many message distribution with automatic fan-out
- **Type-Safe Messages**: Full TypeScript support with schema validation using TypeBox
- **Real-time Processing**: Immediate message delivery to active subscribers
- **Event Filtering**: Subscribe to specific message types using filter functions
- **Timeout Support**: Wait for specific messages with configurable timeouts
- **Multiple Backends**: Support for in-memory, Redis, and custom topic providers
- **Error Resilience**: Built-in error handling and message processing recovery

**Use Cases**

Perfect for event-driven architectures and real-time communication:
- User activity notifications
- Real-time chat and messaging systems
- System event broadcasting
- Microservice communication
- Live data updates and synchronization
- Application state change notifications
- Webhook and external API event handling

**Basic topic with publish/subscribe:**
```ts
import { $topic } from "alepha/topic";
import { t } from "alepha";

class NotificationService {
  userActivity = $topic({
    name: "user-activity",
    schema: {
      payload: t.object({
        userId: t.string(),
        action: t.enum(["login", "logout", "purchase"]),
        timestamp: t.number(),
        metadata: t.optional(t.record(t.string(), t.any()))
      })
    },
    handler: async (message) => {
      // This subscriber runs automatically for all messages
      console.log(`User ${message.payload.userId} performed ${message.payload.action}`);
    }
  });

  async trackUserLogin(userId: string) {
    // Publish event - all subscribers will receive it
    await this.userActivity.publish({
      userId,
      action: "login",
      timestamp: Date.now(),
      metadata: { source: "web", ip: "192.168.1.1" }
    });
  }

  async setupAdditionalSubscriber() {
    // Add another subscriber dynamically
    await this.userActivity.subscribe(async (message) => {
      if (message.payload.action === "purchase") {
        await this.sendPurchaseConfirmation(message.payload.userId);
      }
    });
  }
}
```

**Real-time chat system with multiple subscribers:**
```ts
class ChatService {
  messagesTopic = $topic({
    name: "chat-messages",
    description: "Real-time chat messages for all rooms",
    schema: {
      payload: t.object({
        messageId: t.string(),
        roomId: t.string(),
        userId: t.string(),
        content: t.string(),
        timestamp: t.number(),
        messageType: t.enum(["text", "image", "file"])
      })
    }
  });

  async sendMessage(roomId: string, userId: string, content: string) {
    await this.messagesTopic.publish({
      messageId: generateId(),
      roomId,
      userId,
      content,
      timestamp: Date.now(),
      messageType: "text"
    });
  }

  // Different services can subscribe to the same topic
  async setupMessageLogging() {
    await this.messagesTopic.subscribe(async (message) => {
      // Log all messages for compliance
      await this.auditLogger.log({
        action: "message_sent",
        roomId: message.payload.roomId,
        userId: message.payload.userId,
        timestamp: message.payload.timestamp
      });
    });
  }

  async setupNotificationService() {
    await this.messagesTopic.subscribe(async (message) => {
      // Send push notifications to offline users
      const offlineUsers = await this.getOfflineUsersInRoom(message.payload.roomId);
      await this.sendPushNotifications(offlineUsers, {
        title: `New message in ${message.payload.roomId}`,
        body: message.payload.content
      });
    });
  }
}
```

**Event filtering and waiting for specific messages:**
```ts
class OrderService {
  orderEvents = $topic({
    name: "order-events",
    schema: {
      payload: t.object({
        orderId: t.string(),
        status: t.union([
          t.literal("created"),
          t.literal("paid"),
          t.literal("shipped"),
          t.literal("delivered"),
          t.literal("cancelled")
        ]),
        timestamp: t.number(),
        data: t.optional(t.record(t.string(), t.any()))
      })
    }
  });

  async processOrder(orderId: string) {
    // Publish order created event
    await this.orderEvents.publish({
      orderId,
      status: "created",
      timestamp: Date.now()
    });

    // Wait for payment confirmation with timeout
    try {
      const paymentEvent = await this.orderEvents.wait({
        timeout: [5, "minutes"],
        filter: (message) =>
          message.payload.orderId === orderId &&
          message.payload.status === "paid"
      });

      console.log(`Order ${orderId} was paid at ${paymentEvent.payload.timestamp}`);

      // Continue with shipping...
      await this.initiateShipping(orderId);

    } catch (error) {
      if (error instanceof TopicTimeoutError) {
        console.log(`Payment timeout for order ${orderId}`);
        await this.cancelOrder(orderId);
      }
    }
  }

  async setupOrderTracking() {
    // Subscribe only to shipping events
    await this.orderEvents.subscribe(async (message) => {
      if (message.payload.status === "shipped") {
        await this.updateTrackingInfo(message.payload.orderId, message.payload.data);
        await this.notifyCustomer(message.payload.orderId, "Your order has shipped!");
      }
    });
  }
}
```

**Redis-backed topic for distributed systems:**
```ts
class DistributedEventSystem {
  systemEvents = $topic({
    name: "system-events",
    provider: RedisTopicProvider,  // Use Redis for cross-service communication
    schema: {
      payload: t.object({
        eventType: t.string(),
        serviceId: t.string(),
        data: t.record(t.string(), t.any()),
        timestamp: t.number(),
        correlationId: t.optional(t.string())
      })
    },
    handler: async (message) => {
      // Central event handler for all system events
      await this.processSystemEvent(message.payload);
    }
  });

  async publishServiceHealth(serviceId: string, healthy: boolean) {
    await this.systemEvents.publish({
      eventType: "service.health",
      serviceId,
      data: { healthy, checkedAt: new Date().toISOString() },
      timestamp: Date.now()
    });
  }

  async setupHealthMonitoring() {
    await this.systemEvents.subscribe(async (message) => {
      if (message.payload.eventType === "service.health") {
        await this.updateServiceStatus(
          message.payload.serviceId,
          message.payload.data.healthy
        );

        if (!message.payload.data.healthy) {
          await this.alertOnCall(`Service ${message.payload.serviceId} is down`);
        }
      }
    });
  }
}
```
