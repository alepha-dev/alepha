import type { Infer } from "alepha";

import type { ChannelPrimitive, TWSObject } from "../primitives/$channel.ts";

/**
 * WebSocket connection interface
 */
export interface WebSocketConnection {
  /**
   * Unique connection ID
   */
  id: string;

  /**
   * User ID (if authenticated and security module is used)
   */
  userId?: string;

  /**
   * Channel path this connection belongs to
   */
  channelPath: string;

  /**
   * Room IDs that this connection is currently in
   */
  roomIds: string[];

  /**
   * Send a message to this connection
   */
  send(message: any): Promise<void>;

  /**
   * Close this connection
   */
  close(code?: number, reason?: string): Promise<void>;

  /**
   * Connection metadata (custom data)
   */
  metadata?: Record<string, any>;

  /**
   * Connection state
   */
  readyState: WebSocketState;
}

/**
 * WebSocket state enum
 */
export enum WebSocketState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

/**
 * WebSocket endpoint configuration (server-side)
 */
export interface WebSocketPrimitiveOptions<
  TClient extends TWSObject,
  TServer extends TWSObject,
> {
  /**
   * Channel definition with schema and path
   */
  channel: ChannelPrimitive<TClient, TServer>;

  /**
   * Handler for incoming messages from clients
   */
  handler: WebSocketHandler<TClient, TServer>;

  /**
   * Optional connection handler (called when a client connects)
   */
  onConnect?: (params: {
    /**
     * Unique connection ID of the client
     */
    connectionId: string;

    /**
     * User ID of the connected client (if authenticated and security module is used)
     */
    userId?: string;

    /**
     * Room IDs that the client is connecting to
     */
    roomIds: string[];
  }) => Promise<void> | void;

  /**
   * Optional disconnection handler (called when a client disconnects)
   */
  onDisconnect?: (params: {
    /**
     * Unique connection ID of the client
     */
    connectionId: string;

    /**
     * User ID of the connected client (if authenticated and security module is used)
     */
    userId?: string;

    /**
     * Room IDs that the client was connected to
     */
    roomIds: string[];
  }) => Promise<void> | void;

  /**
   * Whether to enforce security (authentication, authorization) on this WebSocket endpoint
   * Requires alepha/security integration
   */
  secure?: boolean;

  /**
   * Limit number of connections per user (if authenticated)
   */
  maxConnectionsPerUser?: number;
}

/**
 * WebSocket message handler
 */
export type WebSocketHandler<
  TClient extends TWSObject,
  TServer extends TWSObject,
> = (
  context: WebSocketHandlerContext<TClient, TServer>,
) => Promise<void> | void;

/**
 * WebSocket handler context
 */
export interface WebSocketHandlerContext<
  TClient extends TWSObject,
  TServer extends TWSObject,
> {
  /**
   * Unique connection ID of the client
   */
  connectionId: string;

  /**
   * User ID of the connected client (if authenticated and security module is used)
   */
  userId?: string;

  /**
   * Room ID that the client sent the message from
   */
  roomId: string;

  /**
   * The parsed and validated message from the client
   */
  message: Infer<TServer>;

  /**
   * Reply function tailored to current context (connectionId, roomId)
   */
  reply: (options: {
    /**
     * Message to send
     */
    message: Infer<TClient>;

    /**
     * Optional: specify room ID to send to (defaults to sender's room ID)
     */
    roomId?: string;

    /**
     * Optional: exclude the sender connection from receiving the message
     * Will populate exceptConnectionIds with sender connection ID behind the scenes
     */
    exceptSelf?: boolean;

    /**
     * Optional: exclude specific connection IDs from receiving the message
     */
    exceptConnectionIds?: string[];

    /**
     * Optional: exclude specific user IDs from receiving the message
     * Requires alepha/security integration
     */
    exceptUserIds?: string[];
  }) => Promise<void>;
}

/**
 * Emit options for sending messages from the server
 */
export interface EmitOptions<TClient extends TWSObject> {
  /**
   * Message to send to clients
   */
  message: Infer<TClient>;

  /**
   * Room ID to send the message to
   */
  roomId?: string;

  /**
   * Room IDs to send the message to
   */
  roomIds?: string[];

  /**
   * User ID to send the message to (if authenticated)
   */
  userId?: string;

  /**
   * User IDs to send the message to (if authenticated)
   */
  userIds?: string[];

  /**
   * Connection ID to send the message to
   */
  connectionId?: string;

  /**
   * Connection IDs to send the message to
   */
  connectionIds?: string[];

  /**
   * Optional: exclude specific connection IDs from receiving the message
   */
  exceptConnectionIds?: string[];

  /**
   * Optional: exclude specific user IDs from receiving the message
   * Requires alepha/security integration
   */
  exceptUserIds?: string[];
}
