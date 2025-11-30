import type {
  EmitOptions,
  WebSocketConnection,
  WebSocketPrimitiveOptions,
} from "../interfaces/WebSocketInterfaces.ts";
import type { TWSObject } from "../primitives/$channel.ts";

/**
 * Abstract WebSocket server provider
 *
 * This class provides the base interface that must be implemented by
 * platform-specific providers (Node.js, Browser, etc.)
 */
export abstract class WebSocketServerProvider {
  /**
   * Register a WebSocket endpoint with its channel configuration
   */
  abstract registerEndpoint<
    TClient extends TWSObject,
    TServer extends TWSObject,
  >(config: WebSocketPrimitiveOptions<TClient, TServer>): void;

  /**
   * Emit a message to clients based on targeting criteria
   *
   * This method distributes messages across all server instances via pub/sub.
   */
  abstract emit<TClient extends TWSObject>(
    channelPath: string,
    options: EmitOptions<TClient>,
  ): Promise<void>;

  /**
   * Get all active connections (local to this server instance)
   */
  abstract getConnections(): WebSocketConnection[];

  /**
   * Get connections in a specific room (local to this server instance)
   */
  abstract getRoomConnections(roomId: string): WebSocketConnection[];

  /**
   * Get connections for a specific user (local to this server instance)
   */
  abstract getUserConnections(userId: string): WebSocketConnection[];

  /**
   * Close a specific connection
   */
  abstract closeConnection(
    connectionId: string,
    code?: number,
    reason?: string,
  ): Promise<void>;
}
