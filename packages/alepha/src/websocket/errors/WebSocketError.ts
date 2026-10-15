import { $error, z } from "alepha";

/**
 * A WebSocket failure, with the close `code` when there is one.
 */
export const WebSocketError = $error({
  name: "WEBSOCKET",
  schema: z.object({ code: z.integer().optional() }),
  message: "WebSocket error",
});

export type WebSocketError = InstanceType<typeof WebSocketError>;

/**
 * A WebSocket that could not connect, or lost its connection.
 */
export const WebSocketConnectionError = WebSocketError.extend({
  name: "WEBSOCKET_CONNECTION",
  message: "WebSocket connection failed",
});

export type WebSocketConnectionError = InstanceType<
  typeof WebSocketConnectionError
>;

/**
 * A WebSocket message that does not match its schema.
 */
export const WebSocketValidationError = WebSocketError.extend({
  name: "WEBSOCKET_VALIDATION",
  message: "Invalid WebSocket message",
});

export type WebSocketValidationError = InstanceType<
  typeof WebSocketValidationError
>;
