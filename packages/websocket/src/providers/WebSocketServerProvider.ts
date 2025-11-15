import type { TSchema } from "@alepha/core";
import type {
  WebSocketConfig,
  WebSocketConnection,
} from "../interfaces/WebSocketConnection.ts";

/**
 * Abstract WebSocket server provider
 *
 * This class provides the base interface that must be implemented by
 * platform-specific providers (Node.js, Browser, etc.)
 */
export abstract class WebSocketServerProvider {
  /**
   * Register a WebSocket endpoint
   */
  abstract registerEndpoint<TMessageSchema extends TSchema>(
    config: WebSocketConfig<TMessageSchema>,
  ): void;

  /**
   * Get all active connections
   */
  abstract getConnections(): WebSocketConnection[];

  /**
   * Broadcast a message to all connections
   */
  abstract broadcast(message: any): Promise<void>;

  /**
   * Send a message to a specific connection
   */
  abstract sendTo(connectionId: string, message: any): Promise<void>;

  /**
   * Close a specific connection
   */
  abstract closeConnection(
    connectionId: string,
    code?: number,
    reason?: string,
  ): Promise<void>;
}
