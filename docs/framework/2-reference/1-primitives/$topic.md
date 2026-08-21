# $topic

## Import

```typescript
import { $topic } from "alepha/topic";
```

## Overview

Creates a topic primitive for publish/subscribe messaging and event-driven architecture.

Enables decoupled communication through a pub/sub pattern where publishers send messages
and multiple subscribers receive them. Supports type-safe messages, real-time delivery,
event filtering, and pluggable backends (memory, Redis, custom providers).

**Use Cases**: User notifications, real-time chat, event broadcasting, microservice communication

## Options

| Option        | Type                                       | Required | Description                                                                            |
| ------------- | ------------------------------------------ | -------- | -------------------------------------------------------------------------------------- |
| `name`        | `string`                                   | No       | Unique name identifier for the topic                                                   |
| `description` | `string`                                   | No       | Human-readable description of the topic's purpose and usage                            |
| `provider`    | `"memory" \| Service&lt;TopicProvider&gt;` | No       | Topic provider configuration for message storage and delivery                          |
| `schema`      | `T`                                        | Yes      | Zod schema defining the structure of messages published to this topic                  |
| `handler`     | `TopicHandler&lt;T&gt;`                    | No       | Default subscriber handler function that processes messages published to this topic    |
| `retain`      | `boolean`                                  | No       | Whether the last published message should be retained and delivered to new subscribers |

## Examples

```ts
class NotificationService {
  dateTime = $inject(DateTimeProvider);

  userActivity = $topic({
    name: "user-activity",
    schema: {
      payload: z.object({
        userId: z.text(),
        action: z.enum(["login", "logout", "purchase"]),
        timestamp: z.number(),
      }),
    },
    handler: async (message) => {
      console.log(`User ${message.payload.userId}: ${message.payload.action}`);
    },
  });

  async trackLogin(userId: string) {
    await this.userActivity.publish({
      userId,
      action: "login",
      timestamp: this.dateTime.nowMillis(),
    });
  }

  async subscribeToEvents() {
    await this.userActivity.subscribe(async (message) => {
      // Additional subscriber logic
    });
  }
}
```
