export * from "./errors/WebSocketError.ts";
export * from "./interfaces/RoomInterfaces.ts";
export * from "./interfaces/WebSocketInterfaces.ts";
export * from "./primitives/$channel.ts";
export * from "./primitives/$room.ts";
export * from "./primitives/$websocket.ts";
export * from "./providers/RoomEngine.ts";
export * from "./providers/WebSocketServerProvider.ts";
export * from "./services/RoomManager.ts";
export * from "./services/WebSocketClient.ts";
export * from "./services/WebSocketTopicService.ts";

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
