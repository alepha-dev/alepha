import { $module, type Alepha } from "alepha";
import { AlephaServer } from "alepha/server";
import { AlephaTopic } from "alepha/topic";
import { $channel } from "./primitives/$channel.ts";
import { $room } from "./primitives/$room.ts";
import { $websocket } from "./primitives/$websocket.ts";
import { CloudflareDurableObjectWebSocketServerProvider } from "./providers/CloudflareDurableObjectWebSocketServerProvider.ts";
import { NodeWebSocketServerProvider } from "./providers/NodeWebSocketServerProvider.ts";
import { WebSocketServerProvider } from "./providers/WebSocketServerProvider.ts";
import { RoomManager } from "./services/RoomManager.ts";
import { WebSocketTopicService } from "./services/WebSocketTopicService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export { AlephaWebSocketDurableObject } from "./providers/AlephaWebSocketDurableObject.ts";
export * from "./providers/CloudflareDurableObjectWebSocketServerProvider.ts";
export * from "./providers/NodeWebSocketServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Real-time bidirectional communication.
 *
 * **Features:**
 * - WebSocket server definition
 * - Named communication channels
 * - Type-safe message handling
 * - Connection lifecycle management
 * - Room/channel grouping
 * - Browser compatibility
 * - Providers: Node.js (dev), Cloudflare Durable Objects (workerd)
 *
 * @module alepha.websocket
 */
export const AlephaWebSocket = $module({
  name: "alepha.websocket",
  primitives: [$channel, $websocket, $room],
  services: [WebSocketServerProvider, RoomManager, WebSocketTopicService],
  variants: [
    NodeWebSocketServerProvider,
    CloudflareDurableObjectWebSocketServerProvider,
  ],
  imports: [AlephaServer, AlephaTopic],
  register: (alepha: Alepha) => {
    alepha.with({
      provide: WebSocketServerProvider,
      use: alepha.isTest()
        ? NodeWebSocketServerProvider
        : CloudflareDurableObjectWebSocketServerProvider,
    });
  },
});
