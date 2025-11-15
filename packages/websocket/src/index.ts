import { $module, type Alepha, type DescriptorFactoryLike } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { AlephaTopic } from "@alepha/topic";
import { $channel } from "./descriptors/$channel.ts";
import { $websocket } from "./descriptors/$websocket.ts";
import { NodeWebSocketServerProvider } from "./providers/NodeWebSocketServerProvider.ts";
import { WebSocketServerProvider } from "./providers/WebSocketServerProvider.ts";
import { RoomManager } from "./services/RoomManager.ts";
import { WebSocketTopicService } from "./services/WebSocketTopicService.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
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
 * Provides real-time bidirectional communication using WebSockets.
 *
 * The WebSockets module enables building real-time applications using the `$websocket` descriptor
 * on class properties. It provides automatic connection management, message routing, type-safe
 * message handling, and seamless integration with other Alepha modules.
 *
 * On the server side (Node.js), it uses the 'ws' library to create a WebSocket server.
 * On the client side (browser), it uses the native WebSocket API.
 *
 * @see {@link $websocket}
 * @module alepha.websockets
 */
export const AlephaWebSockets = $module({
  name: "alepha.websockets",
  descriptors: [
    $channel as DescriptorFactoryLike,
    $websocket as DescriptorFactoryLike,
  ],
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
