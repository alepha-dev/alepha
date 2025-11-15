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

Provides a dedicated message subscriber that connects to a topic and processes messages
with custom handler logic, enabling scalable pub/sub architectures where multiple
subscribers can react to the same events independently.

**Key Features**
- Seamless integration with any $topic descriptor
- Full type safety inherited from topic schema
- Real-time message delivery when events are published
- Error isolation between subscribers
- Support for multiple independent subscribers per topic

**Common Use Cases**
- Notification services and audit logging
- Analytics and metrics collection
- Data synchronization and real-time UI updates

```ts
class UserActivityService {
  userEvents = $topic({
    name: "user-activity",
    schema: {
      payload: t.object({
        userId: t.text(),
        action: t.enum(["login", "logout", "purchase"]),
        timestamp: t.number()
      })
    }
  });

  activityLogger = $subscriber({
    topic: this.userEvents,
    handler: async (message) => {
      const { userId, action, timestamp } = message.payload;
      await this.auditLogger.log({
        userId,
        action,
        timestamp
      });
    }
  });

  async trackUserLogin(userId: string) {
    await this.userEvents.publish({
      userId,
      action: "login",
      timestamp: Date.now()
    });
  }
}
```

#### $topic()

Creates a topic descriptor for publish/subscribe messaging and event-driven architecture.

Enables decoupled communication through a pub/sub pattern where publishers send messages
and multiple subscribers receive them. Supports type-safe messages, real-time delivery,
event filtering, and pluggable backends (memory, Redis, custom providers).

**Use Cases**: User notifications, real-time chat, event broadcasting, microservice communication

```ts
class NotificationService {
  userActivity = $topic({
    name: "user-activity",
    schema: {
      payload: t.object({
        userId: t.text(),
        action: t.enum(["login", "logout", "purchase"]),
        timestamp: t.number()
      })
    },
    handler: async (message) => {
      console.log(`User ${message.payload.userId}: ${message.payload.action}`);
    }
  });

  async trackLogin(userId: string) {
    await this.userActivity.publish({ userId, action: "login", timestamp: Date.now() });
  }

  async subscribeToEvents() {
    await this.userActivity.subscribe(async (message) => {
      // Additional subscriber logic
    });
  }
}
```
