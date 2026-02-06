# $subscriber

> Creates a subscriber primitive to listen for messages from a specific topic.

## Import

```typescript
import { $subscriber } from "alepha/topic";
```

## Overview

Creates a subscriber primitive to listen for messages from a specific topic.

Provides a dedicated message subscriber that connects to a topic and processes messages
with custom handler logic, enabling scalable pub/sub architectures where multiple
subscribers can react to the same events independently.

**Key Features**
- Seamless integration with any $topic primitive
- Full type safety inherited from topic schema
- Real-time message delivery when events are published
- Error isolation between subscribers
- Support for multiple independent subscribers per topic

**Common Use Cases**
- Notification services and audit logging
- Analytics and metrics collection
- Data synchronization and real-time UI updates

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `topic` | `TopicPrimitive&lt;T&gt;` | Yes | The topic primitive that this subscriber will listen to for messages |
| `handler` | `TopicHandler&lt;T&gt;` | Yes | Message handler function that processes individual messages from the topic |

## Examples

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

