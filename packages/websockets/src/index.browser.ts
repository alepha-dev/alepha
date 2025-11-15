import { $module, type Alepha, type DescriptorFactoryLike } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $websocket } from "./descriptors/$websocket.ts";
import { BrowserWebSocketProvider } from "./providers/BrowserWebSocketProvider.ts";
import { WebSocketServerProvider } from "./providers/WebSocketServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/BrowserWebSocketProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides real-time bidirectional communication using WebSockets in the browser.
 *
 * The WebSockets module enables building real-time applications using the `$websocket` descriptor
 * on class properties. In the browser, it uses the native WebSocket API to connect to WebSocket
 * servers and provides automatic reconnection, message queuing, and type-safe message handling.
 *
 * @see {@link $websocket}
 * @module alepha.websockets
 */
export const AlephaWebSockets = $module({
  name: "alepha.websockets",
  descriptors: [$websocket as DescriptorFactoryLike],
  services: [WebSocketServerProvider, BrowserWebSocketProvider],
  register: (alepha: Alepha) => {
    alepha.with(AlephaServer);

    alepha.with({
      provide: WebSocketServerProvider,
      use: BrowserWebSocketProvider,
    });
  },
});
