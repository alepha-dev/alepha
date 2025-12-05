# Real-time (WebSockets)

WebSockets are usually a pain. You have to manage connections, handle disconnections, figure out how to route messages, and somehow keep your types in sync between the server and client.

Alepha introduces the concept of **Channels** to solve this.

## 1. Define a Channel

A `$channel` is like a contract. It defines *what* can be sent and *what* can be received. It lives in your code, so both backend and frontend can import it.

```typescript
import { t } from "alepha";
import { $channel } from "alepha/websocket";

export const chatChannel = $channel({
  path: "/ws/chat",
  schema: {
    // Messages the Client sends to the Server
    out: t.object({
      content: t.text(),
    }),
    // Messages the Server sends to the Client
    in: t.object({
      user: t.text(),
      content: t.text(),
      timestamp: t.number()
    }),
  }
});
```

## 2. Server Implementation

On the server, you use `$websocket` to implement the logic.

```typescript
import { $websocket } from "alepha/websocket";

class ChatServer {
  socket = $websocket({
    channel: chatChannel,
    handler: async ({ message, reply, connectionId }) => {
      // 'message' is typed as { content: string }

      // Broadcast to everyone in the room
      await reply({
        message: {
          user: `User ${connectionId}`,
          content: message.content,
          timestamp: Date.now()
        },
        // Don't echo back to sender
        exceptSelf: true
      });
    }
  });
}
```

## 3. Client Implementation

On the frontend, use the `useRoom` hook.

```tsx
import { useRoom } from "@alepha/react/websocket";

const ChatRoom = ({ roomId }) => {
  const [messages, setMessages] = useState([]);

  const chat = useRoom({
    channel: chatChannel,
    roomId: roomId,
    handler: (msg) => {
      // 'msg' is fully typed here!
      setMessages(prev => [...prev, msg]);
    }
  }, []);

  return (
    <div>
      {messages.map(m => <div>{m.user}: {m.content}</div>)}

      <button onClick={() => chat.send({ content: "Hello!" })}>
        Send
      </button>
    </div>
  );
};
```

## Scaling?

"But what if I have multiple servers?"

Alepha handles this. The `$websocket` primitive uses the internal Event Bus (`$topic`). If you configure a Redis provider, Alepha automatically broadcasts messages across all your server instances.

You write the code once. It works on one server. It works on ten servers.
