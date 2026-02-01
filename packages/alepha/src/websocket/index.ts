import { $module, type Alepha } from "alepha";
import { AlephaServer } from "alepha/server";
import { AlephaTopic } from "alepha/topic";
import { $channel } from "./primitives/$channel.ts";
import { $websocket } from "./primitives/$websocket.ts";
import { NodeWebSocketServerProvider } from "./providers/NodeWebSocketServerProvider.ts";
import { WebSocketServerProvider } from "./providers/WebSocketServerProvider.ts";
import { RoomManager } from "./services/RoomManager.ts";
import { WebSocketTopicService } from "./services/WebSocketTopicService.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * Fires when a WebSocket connection is established
     */
    "websocket:connect": {
      connectionId: string;
      path: string;
    };

    /**
     * Fires when a WebSocket connection is closed
     */
    "websocket:disconnect": {
      connectionId: string;
      path: string;
      code?: number;
      reason?: string;
    };

    /**
     * Fires when a WebSocket message is received
     */
    "websocket:message": {
      connectionId: string;
      path: string;
      message: any;
    };

    /**
     * Fires when a WebSocket error occurs
     */
    "websocket:error": {
      connectionId: string;
      path: string;
      error: Error;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/NodeWebSocketServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 1 - experimental | 0.19.0 | node, browser|
 *
 * Real-time bidirectional communication.
 *
 * **Features:**
 * - WebSocket server definition
 * - Named communication channels
 * - Type-safe message handling
 * - Connection lifecycle management
 * - Room/channel grouping
 * - Browser compatibility
 *
 * @module alepha.websocket
 */
export const AlephaWebSocket = $module({
  name: "alepha.websocket",
  primitives: [$channel, $websocket],
  services: [
    WebSocketServerProvider,
    NodeWebSocketServerProvider,
    RoomManager,
    WebSocketTopicService,
  ],
  register: (alepha: Alepha) => {
    alepha.with(AlephaServer);
    alepha.with(AlephaTopic);

    alepha.with({
      provide: WebSocketServerProvider,
      use: NodeWebSocketServerProvider,
    });
  },
});
