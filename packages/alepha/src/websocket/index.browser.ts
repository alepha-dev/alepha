import { $module, type Alepha } from "alepha";
import { AlephaTopic } from "alepha/topic";

import { $channel } from "./primitives/$channel.ts";
import { $websocket } from "./primitives/$websocket.ts";
import { WebSocketClient } from "./services/WebSocketClient.ts";

/**
 * alepha/websocket (Browser)
 *
 * Browser-side WebSocket client module. Provides WebSocketClient service
 * for managing WebSocket connections from the browser.
 *
 * For React applications, use alepha/react/websocket with the useRoom hook.
 */
export * from "./index.shared.ts";

export const AlephaWebSocket = $module({
  name: "alepha.websocket",
  primitives: [$channel, $websocket],
  services: [WebSocketClient],
  register: (alepha: Alepha) => {
    alepha.with(AlephaTopic);
    alepha.with(WebSocketClient);
  },
});
