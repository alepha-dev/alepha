# Alepha Websocket

Real-time bidirectional communication using WebSockets.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides real-time bidirectional communication using WebSockets.

The WebSockets module enables building real-time applications using the `$websocket` descriptor
on class properties. It provides automatic connection management, message routing, type-safe
message handling, and seamless integration with other Alepha modules.

On the server side (Node.js), it uses the 'ws' library to create a WebSocket server.
On the client side (browser), it uses the native WebSocket API.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaWebsocket } from "alepha/websocket";

const alepha = Alepha.create()
	.with(AlephaWebsocket);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $websocket()

Create a WebSocket endpoint.

WebSockets provide real-time bidirectional communication between clients and servers.
This descriptor makes it easy to define WebSocket endpoints with full TypeScript type safety,
automatic message validation, and integrated security features.

```typescript
class ChatController {
  chat = $websocket({
    path: "/ws/chat",
    description: "Real-time chat WebSocket",
    schema: {
      message: t.object({
        type: t.enum(["text", "image"]),
        content: t.text(),
        userId: t.text()
      })
    },
    handler: async ({ message, broadcast }) => {
      await broadcast(message);
    }
  });
}
```

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/providers).

#### BrowserWebSocketProvider

Browser WebSocket client provider

Manages WebSocket connections in the browser using the native WebSocket API.
Provides automatic reconnection, message queuing, and type-safe handlers.
