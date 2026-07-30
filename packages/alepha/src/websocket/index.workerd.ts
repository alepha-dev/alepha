import { $module, type Alepha } from "alepha";
import { AlephaServer } from "alepha/server";
import { AlephaTopic } from "alepha/topic";
import { $channel } from "./primitives/$channel.ts";
import { $room } from "./primitives/$room.ts";
import { $websocket } from "./primitives/$websocket.ts";
import { CloudflareDurableObjectWebSocketServerProvider } from "./providers/CloudflareDurableObjectWebSocketServerProvider.ts";
import { WebSocketServerProvider } from "./providers/WebSocketServerProvider.ts";
import { RoomManager } from "./services/RoomManager.ts";
import { WebSocketTopicService } from "./services/WebSocketTopicService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export { AlephaWebSocketDurableObject } from "./providers/AlephaWebSocketDurableObject.ts";
export * from "./providers/CloudflareDurableObjectWebSocketServerProvider.ts";

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
 * - Provider: Cloudflare Durable Objects (workerd)
 *
 * The Node provider (and its `ws` dependency) is deliberately absent from
 * this entry: workerd server builds bundle with `noExternal`, and `ws`'s
 * CommonJS modules eagerly `require` node builtins at module scope, which
 * kills the worker during Cloudflare's deploy-time script validation. A
 * workerd runtime can never run the Node provider anyway, so the workerd
 * graph must not reach it (see `__tests__/workerd-entry-graph.spec.ts`).
 *
 * @module alepha.websocket
 */
export const AlephaWebSocket = $module({
  name: "alepha.websocket",
  primitives: [$channel, $websocket, $room],
  services: [WebSocketServerProvider, RoomManager, WebSocketTopicService],
  variants: [CloudflareDurableObjectWebSocketServerProvider],
  imports: [AlephaServer, AlephaTopic],
  register: (alepha: Alepha) => {
    alepha.with({
      provide: WebSocketServerProvider,
      use: CloudflareDurableObjectWebSocketServerProvider,
    });
  },
});
